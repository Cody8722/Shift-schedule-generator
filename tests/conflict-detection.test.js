const request = require('supertest');
const app = require('../server');

describe('POST /api/schedules/validate - 班表衝突檢測', () => {
    describe('重複排班檢測 (duplicate)', () => {
        it('應該檢測到同一人在同一天的重複排班', async () => {
            const scheduleData = [
                {
                    schedule: [
                        // Day 0: 早班和晚班都排了員工A（重複）
                        [
                            ['員工A'], // 早班
                            ['員工A']  // 晚班（重複！）
                        ],
                        [['員工B'], ['員工C']], // Day 1
                        [['員工D'], ['員工E']], // Day 2
                        [['員工F'], ['員工G']], // Day 3
                        [['員工H'], ['員工I']]  // Day 4
                    ],
                    scheduleDays: [
                        { date: '20250101', shouldSchedule: true, description: '' },
                        { date: '20250102', shouldSchedule: true, description: '' },
                        { date: '20250103', shouldSchedule: true, description: '' },
                        { date: '20250106', shouldSchedule: true, description: '' },
                        { date: '20250107', shouldSchedule: true, description: '' }
                    ],
                    tasks: [
                        { name: '早班', count: 1 },
                        { name: '晚班', count: 1 }
                    ]
                }
            ];

            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: scheduleData,
                    constraints: {
                        maxConsecutiveDays: 5,
                        minRestDays: 2
                    }
                })
                .expect(200);

            expect(response.body.valid).toBe(false);
            expect(response.body.conflicts).toHaveLength(1);
            expect(response.body.conflicts[0].type).toBe('duplicate');
            expect(response.body.conflicts[0].person).toBe('員工A');
            expect(response.body.conflicts[0].date).toBe('20250101');
        });

        it('應該允許不同員工在同一天工作（無重複）', async () => {
            const scheduleData = [
                {
                    schedule: [
                        [['員工A'], ['員工B']], // Day 0: 不同員工
                        [['員工C'], ['員工D']], // Day 1
                        [['員工E'], ['員工F']], // Day 2
                        [['員工G'], ['員工H']], // Day 3
                        [['員工I'], ['員工J']]  // Day 4
                    ],
                    scheduleDays: [
                        { date: '20250101', shouldSchedule: true, description: '' },
                        { date: '20250102', shouldSchedule: true, description: '' },
                        { date: '20250103', shouldSchedule: true, description: '' },
                        { date: '20250106', shouldSchedule: true, description: '' },
                        { date: '20250107', shouldSchedule: true, description: '' }
                    ],
                    tasks: [
                        { name: '早班', count: 1 },
                        { name: '晚班', count: 1 }
                    ]
                }
            ];

            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: scheduleData,
                    constraints: {
                        maxConsecutiveDays: 5,
                        minRestDays: 2
                    }
                })
                .expect(200);

            expect(response.body.valid).toBe(true);
            expect(response.body.conflicts).toHaveLength(0);
        });
    });

    describe('過勞檢測 (overwork)', () => {
        it('應該檢測到連續工作天數超過限制', async () => {
            const scheduleData = [
                {
                    // Week 1: 員工A 工作 5 天（週一到週五）
                    schedule: [
                        [['員工A']], // 20250101
                        [['員工A']], // 20250102
                        [['員工A']], // 20250103
                        [['員工A']], // 20250106
                        [['員工A']]  // 20250107
                    ],
                    scheduleDays: [
                        { date: '20250101', shouldSchedule: true, description: '' },
                        { date: '20250102', shouldSchedule: true, description: '' },
                        { date: '20250103', shouldSchedule: true, description: '' },
                        { date: '20250106', shouldSchedule: true, description: '' },
                        { date: '20250107', shouldSchedule: true, description: '' }
                    ],
                    tasks: [{ name: '早班', count: 1 }]
                },
                {
                    // Week 2: 員工A 又工作 2 天（連續第 6、7 天，超過限制 5 天）
                    schedule: [
                        [['員工A']], // 20250108 (第6天)
                        [['員工A']], // 20250109 (第7天，超過!)
                        [['員工B']], // 20250110
                        [['員工B']], // 20250113
                        [['員工B']]  // 20250114
                    ],
                    scheduleDays: [
                        { date: '20250108', shouldSchedule: true, description: '' },
                        { date: '20250109', shouldSchedule: true, description: '' },
                        { date: '20250110', shouldSchedule: true, description: '' },
                        { date: '20250113', shouldSchedule: true, description: '' },
                        { date: '20250114', shouldSchedule: true, description: '' }
                    ],
                    tasks: [{ name: '早班', count: 1 }]
                }
            ];

            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: scheduleData,
                    constraints: {
                        maxConsecutiveDays: 5, // 最多連續工作 5 天
                        minRestDays: 2
                    }
                })
                .expect(200);

            expect(response.body.valid).toBe(false);
            expect(response.body.conflicts.length).toBeGreaterThan(0);

            const overworkConflict = response.body.conflicts.find(c => c.type === 'overwork');
            expect(overworkConflict).toBeDefined();
            expect(overworkConflict.person).toBe('員工A');
            expect(overworkConflict.consecutiveDays).toBeGreaterThan(5);
        });

        it('應該允許連續工作天數在限制內', async () => {
            const scheduleData = [
                {
                    // 員工A 只工作 3 天（在限制 5 天內）
                    schedule: [
                        [['員工A']], // 20250101
                        [['員工A']], // 20250102
                        [['員工A']], // 20250103
                        [['員工B']], // 20250106
                        [['員工B']]  // 20250107
                    ],
                    scheduleDays: [
                        { date: '20250101', shouldSchedule: true, description: '' },
                        { date: '20250102', shouldSchedule: true, description: '' },
                        { date: '20250103', shouldSchedule: true, description: '' },
                        { date: '20250106', shouldSchedule: true, description: '' },
                        { date: '20250107', shouldSchedule: true, description: '' }
                    ],
                    tasks: [{ name: '早班', count: 1 }]
                }
            ];

            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: scheduleData,
                    constraints: {
                        maxConsecutiveDays: 5,
                        minRestDays: 2
                    }
                })
                .expect(200);

            expect(response.body.valid).toBe(true);
            expect(response.body.conflicts).toHaveLength(0);
        });
    });

    describe('邊界條件測試', () => {
        it('應該拒絕空白班表數據', async () => {
            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: [],
                    constraints: {
                        maxConsecutiveDays: 5,
                        minRestDays: 2
                    }
                })
                .expect(400);

            expect(response.body.message).toContain('班表數據必須是非空數組');
        });

        it('應該使用預設限制條件（如果未提供）', async () => {
            const scheduleData = [
                {
                    schedule: [
                        [['員工A']], [['員工A']], [['員工A']], [['員工A']], [['員工A']]
                    ],
                    scheduleDays: [
                        { date: '20250101', shouldSchedule: true, description: '' },
                        { date: '20250102', shouldSchedule: true, description: '' },
                        { date: '20250103', shouldSchedule: true, description: '' },
                        { date: '20250106', shouldSchedule: true, description: '' },
                        { date: '20250107', shouldSchedule: true, description: '' }
                    ],
                    tasks: [{ name: '早班', count: 1 }]
                }
            ];

            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: scheduleData
                    // 不提供 constraints，應使用預設值
                })
                .expect(200);

            // 預設 maxConsecutiveDays = 5，所以 5 天連續工作應該通過
            expect(response.body.valid).toBe(true);
        });

        it('應該忽略假日（不計入工作日）', async () => {
            const scheduleData = [
                {
                    schedule: [
                        [['員工A']], // 20250101
                        [['員工A']], // 20250102 (假日，不應計入)
                        [['員工A']], // 20250103
                        [['員工A']], // 20250106
                        [['員工A']]  // 20250107
                    ],
                    scheduleDays: [
                        { date: '20250101', shouldSchedule: true, description: '' },
                        { date: '20250102', shouldSchedule: false, description: '假日' }, // 假日
                        { date: '20250103', shouldSchedule: true, description: '' },
                        { date: '20250106', shouldSchedule: true, description: '' },
                        { date: '20250107', shouldSchedule: true, description: '' }
                    ],
                    tasks: [{ name: '早班', count: 1 }]
                }
            ];

            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: scheduleData,
                    constraints: {
                        maxConsecutiveDays: 5,
                        minRestDays: 2
                    }
                })
                .expect(200);

            // 假日應該被忽略，所以連續工作應該被中斷
            expect(response.body.valid).toBe(true);
        });
    });

    describe('複合衝突測試', () => {
        it('應該同時檢測重複排班和過勞問題', async () => {
            const scheduleData = [
                {
                    schedule: [
                        [['員工A'], ['員工A']], // 重複排班
                        [['員工A']],
                        [['員工A']],
                        [['員工A']],
                        [['員工A']]
                    ],
                    scheduleDays: [
                        { date: '20250101', shouldSchedule: true, description: '' },
                        { date: '20250102', shouldSchedule: true, description: '' },
                        { date: '20250103', shouldSchedule: true, description: '' },
                        { date: '20250106', shouldSchedule: true, description: '' },
                        { date: '20250107', shouldSchedule: true, description: '' }
                    ],
                    tasks: [
                        { name: '早班', count: 1 },
                        { name: '晚班', count: 1 }
                    ]
                },
                {
                    schedule: [
                        [['員工A']], // 第 6 天（過勞）
                        [['員工A']], // 第 7 天（過勞）
                        [['員工B']],
                        [['員工B']],
                        [['員工B']]
                    ],
                    scheduleDays: [
                        { date: '20250108', shouldSchedule: true, description: '' },
                        { date: '20250109', shouldSchedule: true, description: '' },
                        { date: '20250110', shouldSchedule: true, description: '' },
                        { date: '20250113', shouldSchedule: true, description: '' },
                        { date: '20250114', shouldSchedule: true, description: '' }
                    ],
                    tasks: [{ name: '早班', count: 1 }]
                }
            ];

            const response = await request(app)
                .post('/api/schedules/validate')
                .send({
                    schedule: scheduleData,
                    constraints: {
                        maxConsecutiveDays: 5,
                        minRestDays: 2
                    }
                })
                .expect(200);

            expect(response.body.valid).toBe(false);

            // 應該有重複排班衝突
            const duplicateConflicts = response.body.conflicts.filter(c => c.type === 'duplicate');
            expect(duplicateConflicts.length).toBeGreaterThan(0);

            // 應該有過勞衝突
            const overworkConflicts = response.body.conflicts.filter(c => c.type === 'overwork');
            expect(overworkConflicts.length).toBeGreaterThan(0);
        });
    });
});
