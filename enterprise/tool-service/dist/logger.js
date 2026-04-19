"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = void 0;
const winston_1 = __importDefault(require("winston"));
const createLogger = () => {
    return winston_1.default.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        defaultMeta: { service: 'enterprise-tool-service' },
        format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
        transports: [new winston_1.default.transports.Console()],
    });
};
exports.createLogger = createLogger;
