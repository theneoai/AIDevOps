"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const configSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: zod_1.z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    SERVICE_PORT: zod_1.z
        .string()
        .default('3000')
        .transform((val) => parseInt(val, 10))
        .refine((val) => val >= 1 && val <= 65535, {
        message: 'SERVICE_PORT must be between 1 and 65535',
    }),
});
const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
    const formatted = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('\n');
    throw new Error(`Config validation failed:\n${formatted}`);
}
exports.config = parsed.data;
