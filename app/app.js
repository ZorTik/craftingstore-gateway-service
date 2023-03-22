const express = require("express");
const app = express();
app.use((req, res, next) => {
    let data = "";
    req.on("data", chunk => {data += chunk;});
    req.on("end", () => {
        req.rawBody = data;
        next();
    });
});

const gateway = new (require("gateway"))({
    services: {},
    express: express,
    registerServiceRouter: (serviceName, router) => {
        router.post("/init", (req, res) => {
            const serviceName = req.params.service;
            gateway.handleCSRequest(serviceName, req, res);
        });
        app.use("/service/:service", router);
    }
});

process.env.ENABLED_SERVICES.split(",").forEach(serviceName => {
    const service = require(`./service/${serviceName}`);
    gateway.registerService(serviceName, service);
});

app.listen(process.env.PORT, () => {
    console.log(`Gateway listening on port ${process.env.PORT}`);
});
