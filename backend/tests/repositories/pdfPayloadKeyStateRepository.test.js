'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../../src/db/connect', () => ({
  getPdfPayloadKeyStateCollection: jest.fn(),
}));

const { getPdfPayloadKeyStateCollection } = require('../../src/db/connect');
const { getState, setState } = require('../../src/repositories/pdfPayloadKeyStateRepository');

const makeCol = () => ({
  findOne: jest.fn().mockResolvedValue(null),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getState', () => {
  it('依固定 _id 查詢狀態文件', async () => {
    const col = makeCol();
    col.findOne.mockResolvedValue({ _id: 'pdf_payload_key_state', currentVersion: 'v2', rotatedAt: '2026-01-01' });
    getPdfPayloadKeyStateCollection.mockReturnValue(col);
    const result = await getState();
    expect(col.findOne).toHaveBeenCalledWith({ _id: 'pdf_payload_key_state' });
    expect(result.currentVersion).toBe('v2');
  });

  it('查無資料時回傳 null', async () => {
    const col = makeCol();
    getPdfPayloadKeyStateCollection.mockReturnValue(col);
    expect(await getState()).toBeNull();
  });
});

describe('setState', () => {
  it('用 upsert 寫入固定 _id 的文件', async () => {
    const col = makeCol();
    getPdfPayloadKeyStateCollection.mockReturnValue(col);
    await setState('v3', '2026-06-01T00:00:00.000Z');
    expect(col.updateOne).toHaveBeenCalledWith(
      { _id: 'pdf_payload_key_state' },
      { $set: { currentVersion: 'v3', rotatedAt: '2026-06-01T00:00:00.000Z' } },
      { upsert: true }
    );
  });
});
