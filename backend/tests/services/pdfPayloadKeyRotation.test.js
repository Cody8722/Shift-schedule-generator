'use strict';

process.env.NODE_ENV = 'test';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('pdfPayloadKeyRotation', () => {
  // isDbConnected/getState/setState 都用 mock 控制；每個測試重新 resetModules +
  // doMock，確保 config.js 的 PDF_PAYLOAD_KEK_CURRENT 跟這幾個依賴都是全新的、
  // 不會被上一個測試的呼叫紀錄或殘留狀態干擾。
  const loadModule = ({ dbConnected = true, seedEnv, getStateResult = null, setStateImpl } = {}) => {
    jest.resetModules();
    if (seedEnv === undefined) delete process.env.PDF_PAYLOAD_KEK_CURRENT;
    else process.env.PDF_PAYLOAD_KEK_CURRENT = seedEnv;

    const getState = jest.fn().mockResolvedValue(getStateResult);
    const setState = setStateImpl || jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../src/db/connect', () => ({
      getIsDbConnected: jest.fn().mockReturnValue(dbConnected),
    }));
    jest.doMock('../../src/repositories/pdfPayloadKeyStateRepository', () => ({ getState, setState }));

    const mod = require('../../src/services/pdfPayloadKeyRotation');
    return { mod, getState, setState };
  };

  afterEach(() => {
    delete process.env.PDF_PAYLOAD_KEK_CURRENT;
  });

  describe('initKeyState', () => {
    it('DB 未連線時不做任何事，getCurrentVersion 維持 null', async () => {
      const { mod, getState, setState } = loadModule({ dbConnected: false });
      await mod.initKeyState();
      expect(getState).not.toHaveBeenCalled();
      expect(setState).not.toHaveBeenCalled();
      expect(mod.getCurrentVersion()).toBeNull();
    });

    it('資料庫已有狀態文件時直接載入，不會呼叫 setState', async () => {
      const { mod, setState } = loadModule({
        getStateResult: { currentVersion: 'v5', rotatedAt: '2026-01-01T00:00:00.000Z' },
      });
      await mod.initKeyState();
      expect(mod.getCurrentVersion()).toBe('v5');
      expect(setState).not.toHaveBeenCalled();
    });

    it('資料庫沒有狀態文件、有設定 PDF_PAYLOAD_KEK_CURRENT 時，用它當種子值建立', async () => {
      const { mod, setState } = loadModule({ getStateResult: null, seedEnv: 'v3' });
      await mod.initKeyState();
      expect(mod.getCurrentVersion()).toBe('v3');
      expect(setState).toHaveBeenCalledWith('v3', expect.any(String));
    });

    it('資料庫沒有狀態文件、也沒設定種子環境變數時，預設用 v1', async () => {
      const { mod, setState } = loadModule({ getStateResult: null });
      await mod.initKeyState();
      expect(mod.getCurrentVersion()).toBe('v1');
      expect(setState).toHaveBeenCalledWith('v1', expect.any(String));
    });

    it('種子環境變數格式不合法時，忽略它、改用預設 v1', async () => {
      const { mod } = loadModule({ getStateResult: null, seedEnv: 'not-a-version' });
      await mod.initKeyState();
      expect(mod.getCurrentVersion()).toBe('v1');
    });

    it('寫入資料庫失敗時不拋出例外，getCurrentVersion 維持 null', async () => {
      const { mod } = loadModule({
        getStateResult: null,
        setStateImpl: jest.fn().mockRejectedValue(new Error('db down')),
      });
      await expect(mod.initKeyState()).resolves.not.toThrow();
      expect(mod.getCurrentVersion()).toBeNull();
    });
  });

  describe('getRotationStatus', () => {
    it('尚未初始化時全部欄位為 null', () => {
      const { mod } = loadModule({ dbConnected: false });
      expect(mod.getRotationStatus()).toEqual({ currentVersion: null, rotatedAt: null, nextRotationDue: null });
    });

    it('初始化後回傳目前版本、上次輪替時間、下次預計輪替時間（+30 天）', async () => {
      const rotatedAt = '2026-01-01T00:00:00.000Z';
      const { mod } = loadModule({ getStateResult: { currentVersion: 'v2', rotatedAt } });
      await mod.initKeyState();
      const status = mod.getRotationStatus();
      expect(status.currentVersion).toBe('v2');
      expect(status.rotatedAt).toBe(rotatedAt);
      expect(new Date(status.nextRotationDue).getTime() - new Date(rotatedAt).getTime()).toBe(30 * DAY_MS);
    });
  });

  describe('rotateIfDue', () => {
    it('DB 未連線時不做任何事', async () => {
      const { mod, setState } = loadModule({ dbConnected: false });
      await mod.rotateIfDue();
      expect(setState).not.toHaveBeenCalled();
    });

    it('尚未初始化（cachedState 為 null）時不做任何事', async () => {
      const { mod, setState } = loadModule({ getStateResult: null });
      // 故意不呼叫 initKeyState()，模擬還沒初始化就先被呼叫的情況
      await mod.rotateIfDue();
      expect(setState).not.toHaveBeenCalled();
    });

    it('距離上次輪替不到 30 天時不輪替', async () => {
      const rotatedAt = new Date(Date.now() - 5 * DAY_MS).toISOString();
      const { mod, setState } = loadModule({ getStateResult: { currentVersion: 'v1', rotatedAt } });
      await mod.initKeyState();
      await mod.rotateIfDue();
      expect(setState).not.toHaveBeenCalled();
      expect(mod.getCurrentVersion()).toBe('v1');
    });

    it('距離上次輪替滿 30 天時自動升版並寫回資料庫', async () => {
      const rotatedAt = new Date(Date.now() - 31 * DAY_MS).toISOString();
      const { mod, setState } = loadModule({ getStateResult: { currentVersion: 'v1', rotatedAt } });
      await mod.initKeyState();
      await mod.rotateIfDue();
      expect(mod.getCurrentVersion()).toBe('v2');
      expect(setState).toHaveBeenCalledWith('v2', expect.any(String));
    });

    it('版本號正確遞增（v9 → v10）', async () => {
      const rotatedAt = new Date(Date.now() - 31 * DAY_MS).toISOString();
      const { mod } = loadModule({ getStateResult: { currentVersion: 'v9', rotatedAt } });
      await mod.initKeyState();
      await mod.rotateIfDue();
      expect(mod.getCurrentVersion()).toBe('v10');
    });

    it('輪替寫入資料庫失敗時，沿用舊版本繼續運作，不拋出例外', async () => {
      const rotatedAt = new Date(Date.now() - 31 * DAY_MS).toISOString();
      const { mod } = loadModule({
        getStateResult: { currentVersion: 'v1', rotatedAt },
        setStateImpl: jest.fn().mockRejectedValue(new Error('db down')),
      });
      await mod.initKeyState();
      await expect(mod.rotateIfDue()).resolves.not.toThrow();
      expect(mod.getCurrentVersion()).toBe('v1');
    });
  });
});
