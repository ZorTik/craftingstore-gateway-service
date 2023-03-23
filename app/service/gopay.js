const requireEnv = require("../util").requireEnv;
const {digestBody} = require("../util");
const notificationPath = "/notification";
const gopayApiUrl = process.env.GOPAY_URL;
const activeTransactions = {}; // Id (GoPay), Status
const transactionCSIds = {}; // Id (GoPay), CSId

let fetch;
let logger;
(async function() {
    fetch = (await import("node-fetch")).default;
})();

const gopay = {
    hostUrl: "",
    clientId: "",
    clientSecret: "",
    clientToken: "",
    tokenExpires: 0,
    goid: "",
    /**
     * Fetches new token from GoPay.
     * @returns {Promise<void>} Nothing.
     */
    async fetchNewToken() {
        const res = await fetch(gopayApiUrl + "/api/oauth2/token", {
            method: "post",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accepts": "application/json",
                "Authorization": "Basic " + Buffer.from(this.clientId + ":" + this.clientSecret).toString("base64")
            },
            body: "scope=payment-all&grant_type=client_credentials"
        }).then(res => res.json());

        if (!res.access_token || !res.expires_in)
            throw new Error(`Invalid GoPay response: ${JSON.stringify(res)}`);

        this.clientToken = res.access_token;
        this.tokenExpires = Date.now() + res.expires_in * 1000;
    },
    async fetchPaymentInstruments(currency) {
        currency = currency.toUpperCase();
        const response = (await fetch(gopayApiUrl + `/api/eshops/eshop/${this.goid}/payment-instruments/${currency}`,
            await this.prepareGopayRequest())
            .then(res => res.json()));
        logger.debug(`GoPay: Payment instruments: ${JSON.stringify(response)}`);
        return response.enabledPaymentInstruments;
    },
    async fetchTransactionStatus(id) {
        return (await fetch(gopayApiUrl + `/api/payments/payment/${id}`,
            await this.prepareGopayRequest())
            .then(res => res.json())).state;
    },
    /**
     * Prepares fetch request for GoPay. (Adds authorization header)
     * @param fetchInit Fetch init.
     * @returns {Promise<*>} Same fetch init.
     */
    async prepareGopayRequest(fetchInit = {}) {
        if (Date.now() > this.tokenExpires - 10000) {
            logger.info("GoPay: Token expired, fetching new one.");
            await this.fetchNewToken();
        }
        fetchInit.headers = fetchInit.headers || {};
        fetchInit.headers["Authorization"] = "Bearer " + this.clientToken;
        fetchInit.headers["Accepts"] = "application/json";

        return fetchInit;
    },
    /**
     * Performs a creation of new payment.
     * @param csRequest Crafting store init request.
     * @returns {Promise<any>} Response.
     */
    async createNewPayment(csRequest) {
        const allowedSwifts = [];
        const paymentInstruments = await this.fetchPaymentInstruments(csRequest.currency);
        const allowedInstruments = paymentInstruments.map(instrument => instrument.paymentInstrument);
        paymentInstruments.forEach(instrument => {
            if (instrument.swifts) instrument.swifts.forEach(swift => allowedSwifts.push(swift.swift));
        })
        const payer = {
            allowed_payment_instruments: allowedInstruments,
            default_payment_instrument: allowedInstruments[0],
            allowed_swifts: allowedSwifts,
            default_swift: allowedSwifts[0],
            contact: {
                first_name: csRequest.user.firstName ?? "",
                last_name: csRequest.user.lastName ?? "",
                email: csRequest.user.email,
                phone_number: "",
                city: csRequest.user.billingCity ?? "",
                street: (csRequest.user.billingAddressLineOne ?? "") + (csRequest.user.billingAddressLineTwo ?? ""),
                postal_code: csRequest.user.billingZipCode ?? "",
                country_code: csRequest.user.billingCountry ? csRequest.user.billingCountry.code : "",
            }
        }
        const target = {type: "ACCOUNT", goid: this.goid};
        return fetch(gopayApiUrl + "/api/payments/payment", await this.prepareGopayRequest({
            method: "post",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                payer: payer,
                target: target,
                items: [{
                    type: "ITEM",
                    name: csRequest.package.name,
                    amount: csRequest.package.price,
                }],
                amount: csRequest.package.price,
                currency: csRequest.currency,
                order_number: csRequest.transactionId,
                order_description: "",
                callback: {
                    return_url: csRequest.webhook.successUrl,
                    notification_url: this.hostUrl + "/service/gopay" + notificationPath
                },
                additional_params: []
            })
        })).then(res => res.json());
    }
}

/**
 * Handles incoming initial request from CS. (On payment click)
 * @param request Express request.
 * @param response Express response.
 */
async function incomingStoreRequest(request, response) {
    // Already verified in mediator
    const csRequest = request.body;
    // CS sends lowercase currency codes, but GoPay requires uppercase
    csRequest.currency = csRequest.currency.toUpperCase();
    const gopayResponse = await gopay.createNewPayment(csRequest);
    const gpTransactionId = gopayResponse.id;

    logger.debug(`GoPay: CS Request: ${JSON.stringify(csRequest)}`);

    if (!gpTransactionId || !gopayResponse.gw_url)
        throw new Error(`GoPay: Invalid GoPay response: ${JSON.stringify(gopayResponse)}`);

    activeTransactions[gpTransactionId] = "CREATED";
    transactionCSIds[gpTransactionId] = csRequest.transactionId;
    response.status(200).json({
        success: true,
        data: {url: gopayResponse.gw_url}
    });
    logger.info(`GoPay: New payment created. (CS ID: ${csRequest.transactionId}, GP ID: ${gpTransactionId})`);
}

/**
 * Initializes the service.
 * @param router Express router.
 * @param _logger Logger.
 */
function init(router, _logger) {
    requireEnv("HOST_URL");
    requireEnv("GOPAY_URL");
    requireEnv("GOPAY_CLIENT_ID");
    requireEnv("GOPAY_CLIENT_SECRET");
    requireEnv("GOPAY_GOID");

    logger = _logger;

    gopay.hostUrl = process.env.HOST_URL;
    gopay.clientId = process.env.GOPAY_CLIENT_ID;
    gopay.clientSecret = process.env.GOPAY_CLIENT_SECRET;
    gopay.goid = process.env.GOPAY_GOID;

    logger.info(`GoPay: Service initialized. (GOID: ${gopay.goid})`);

    router.get(notificationPath, async (req, res) => {
        const id = req.query.id;
        const status = await gopay.fetchTransactionStatus(id);
        activeTransactions[id] = status;

        logger.info(`GoPay: Transaction ${id} status changed to ${status}.`);

        if (status === "PAID" && transactionCSIds[id]) {
            const csId = transactionCSIds[id];
            delete transactionCSIds[id];
            delete activeTransactions[id];

            const rawBody = `{"type":"paid","transactionId":"${csId}"}`;
            const hash = digestBody(rawBody);

            logger.info(`GoPay: Sending callback to CS for transaction ${csId}.`);

            const callbackResponse = await fetch("https://api.craftingstore.net/callback/custom", {
                method: "post",
                headers: {
                    "X-Signature": hash,
                },
                body: rawBody
            }).then(res => res.json());

            logger.debug(`GoPay: CS Callback response: ${JSON.stringify(callbackResponse)}`);
        }
    });
}

module.exports = {
    init: init,
    handle: incomingStoreRequest,
}
