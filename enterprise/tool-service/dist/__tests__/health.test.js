"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const index_1 = __importDefault(require("../index"));
describe('GET /health', () => {
    it('should return 200 and health info', async () => {
        const res = await (0, supertest_1.default)(index_1.default).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('enterprise-tool-service');
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body).toHaveProperty('uptime');
        expect(typeof res.body.timestamp).toBe('string');
        expect(typeof res.body.uptime).toBe('number');
    });
});
