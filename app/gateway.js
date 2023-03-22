const {requireEnv} = require("./util");
const defaultLogger = {info: console.log};

function GatewayMediator(options) {
    validate(options, 'express');
    validate(options, 'registerServiceRouter');
    requireEnv("GATEWAY_SECRET_KEY");
    this.express = options.express;
    this.registerServiceRouter = options.registerServiceRouter;
    this.services = {};
    this.logger = options.logger || defaultLogger;
    Object.keys(options.services).forEach(key => {
        this.registerService(key, options.services[key]);
    });
}

GatewayMediator.prototype.registerService = function(serviceName, service) {
    this.services[serviceName] = service;
    const router = this.express.Router();
    service.init(router);
    this.registerServiceRouter(serviceName, router);
}

GatewayMediator.prototype.handleCSRequest = function(serviceName, request, response) {
    const statusBody = (status, msg) => {
        return response.status(status).json({status: status, message: msg});
    }

    if (!this.services[serviceName]) {
        statusBody(404, 'Service not found');
        return;
    }

    const hmac = require('crypto').createHmac("sha256", process.env.GATEWAY_SECRET_KEY);
    hmac.update(request.rawBody);
    const hash = hmac.digest('hex');

    if (!request.headers['X-Signature'] || request.headers['X-Signature'] !== hash) {
        this.logger.info("Invalid signature: " + request.headers['X-Signature'] + " vs " + hash);
        statusBody(403, 'Unauthorized');
        return;
    }

    this.services[serviceName].handle(request, response);
}

function validate(obj, key) {
    if (!obj[key]) throw new Error(`Missing ${key} in object!`);
}

module.exports = GatewayMediator;
