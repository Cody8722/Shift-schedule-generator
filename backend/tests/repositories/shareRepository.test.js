'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../../src/db/connect', () => ({
  getScheduleSharesCollection: jest.fn(),
}));

const { getScheduleSharesCollection } = require('../../src/db/connect');
const { createShare, getShare } = require('../../src/repositories/shareRepository');

const makeCol = () => ({
  insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  findOne: jest.fn().mockResolvedValue(null),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createShare', () => {
  it('產生的 token 是 32 字元的 hex 字串', async () => {
    const col = makeCol();
    getScheduleSharesCollection.mockReturnValue(col);
    const token = await createShare('default', 'A', null);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('每次呼叫都產生不同的 token', async () => {
    const col = makeCol();
    getScheduleSharesCollection.mockReturnValue(col);
    const t1 = await createShare('default', 'A', null);
    const t2 = await createShare('default', 'A', null);
    expect(t1).not.toBe(t2);
  });

  it('寫入的文件包含 profile/scheduleName/personFilter/createdAt，_id 即為 token', async () => {
    const col = makeCol();
    getScheduleSharesCollection.mockReturnValue(col);
    const token = await createShare('default', 'A', '張三');
    expect(col.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: token, profile: 'default', scheduleName: 'A', personFilter: '張三' })
    );
  });

  it('personFilter 未提供時存為 null', async () => {
    const col = makeCol();
    getScheduleSharesCollection.mockReturnValue(col);
    await createShare('default', 'A');
    expect(col.insertOne).toHaveBeenCalledWith(expect.objectContaining({ personFilter: null }));
  });
});

describe('getShare', () => {
  it('回傳 collection.findOne 依 _id 查詢的結果', async () => {
    const col = makeCol();
    col.findOne.mockResolvedValue({ _id: 'tok', profile: 'default', scheduleName: 'A', personFilter: null });
    getScheduleSharesCollection.mockReturnValue(col);
    const result = await getShare('tok');
    expect(col.findOne).toHaveBeenCalledWith({ _id: 'tok' });
    expect(result.scheduleName).toBe('A');
  });

  it('查無資料時回傳 null', async () => {
    const col = makeCol();
    getScheduleSharesCollection.mockReturnValue(col);
    const result = await getShare('nope');
    expect(result).toBeNull();
  });
});
