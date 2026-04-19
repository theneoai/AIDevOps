"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const health_1 = __importDefault(require("./routes/health"));
const logger = (0, logger_1.createLogger)();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.get('/', (_req, res) => {
    res.json({
        service: 'enterprise-tool-service',
        version: '1.0.0',
        status: 'running',
    });
});
app.use('/', health_1.default);
app.use((err, _req, res, _next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal Server Error' });
});
if (require.main === module) {
    app.listen(config_1.config.SERVICE_PORT, () => {
        logger.info('Server started', {
            port: config_1.config.SERVICE_PORT,
            env: config_1.config.NODE_ENV,
        });
    });
}
exports.default = app;
