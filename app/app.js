const express = require("express");
const app = express();
const contentType = require("content-type");
const logger = require("./log");
const getRawBody = require("raw-body");

process.env.NODE_DEBUG = "http";

app.set('views', process.cwd() + "/app/views");
app.set('view engine', 'ejs');

const gateway = new (require("./gateway"))({
    services: {},
    express: express,
    logger: logger,
    registerServiceRouter: (serviceName, router) => {
        router.post("/init", async (req, res) => {
            const host = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            logger.info(`Received init request for service ${serviceName} from ${host}...`)
            try {
                req.rawBody = await getRawBody(req, {
                    length: req.headers['content-length'],
                    limit: "1mb",
                    encoding: contentType.parse(req).parameters.charset,
                });
                req.body = JSON.parse(req.rawBody);
                const handleFunc = gateway.preprocessCSRequest(serviceName, req, res);
                if (typeof handleFunc === "function") {
                    await handleFunc(req, res);
                } else throw new Error(handleFunc);
            } catch (e) {
                logger.error(`An error occured: ${e}`);
                console.trace(e);
                res.status(500).send(`{"success":false}`);
            }
        });
        app.use("/service/" + serviceName, router);
    }
});

process.env.ENABLED_SERVICES.split(",").forEach(serviceName => {
    const service = require(`./service/${serviceName}`);
    gateway.registerService(serviceName, service);
});

app.listen(process.env.PORT, () => {
    logger.info(`Gateway listening on port ${process.env.PORT}`);
});
