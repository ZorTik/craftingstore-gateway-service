const express = require("express");
const requireEnv = require("../util").requireEnv;
const fetch = require("node-fetch");
const {digestBody} = require("../util");
const notificationPath = "/notification";
const gopayApiUrl = process.env.GOPAY_URL;
const activeTransactions = {}; // Id (GoPay), Status
const transactionCSIds = {}; // Id (GoPay), CSId
const gopay = {
    hostUrl: "",
    clientId: "",
    clientSecret: "",
    clientToken: "",
    tokenExpires: 0,
    allowedSwifts: [],
    goid: "",
    /**
     * Fetches new token from GoPay.
     * @returns {Promise<void>} Nothing.
     */
    async fetchNewToken() {
        const res = await fetch(gopayApiUrl + "/api/oauth2/token?scope=payment-all&grant_type=client_credentials", {
            method: "post",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accepts": "application/json",
                "Authorization": "Basic " + Buffer.from(this.clientId + ":" + this.clientSecret).toString("base64")
            }
        }).then(res => res.json());

        if (!res.access_token || !res.expires_in)
            throw new Error("GoPay token request failed!");

        this.clientToken = res.access_token;
        this.tokenExpires = Date.now() + res.expires_in * 1000;
    },
    async fetchPaymentInstruments(currency) {
        return (await fetch(gopayApiUrl + `/api/eshops/eshop/${this.goid}/payment-instruments/${currency}`,
            await this.prepareGopayRequest())
            .then(res => res.json())).enabledPaymentInstruments;
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
        if (Date.now() > this.tokenExpires - (this.tokenExpires * 0.1)) {
            console.log("Fetching new token...");
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
        // TODO: https://doc.gopay.com/#payment-creation
        const paymentInstruments = await this.fetchPaymentInstruments(csRequest.currency);
        const allowedInstruments = paymentInstruments.map(instrument => instrument.paymentInstrument);
        const payer = {
            allowed_payment_instruments: allowedInstruments,
            default_payment_instrument: allowedInstruments[0],
            allowed_swifts: this.allowedSwifts,
            default_swift: this.allowedSwifts[0],
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
                    notification_url: this.hostUrl + notificationPath
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
    const gopayResponse = await gopay.createNewPayment(csRequest);
    const gpTransactionId = gopayResponse.id; // TODO: Save
    activeTransactions[gpTransactionId] = "CREATED";
    transactionCSIds[gpTransactionId] = csRequest.transactionId;
    response.status(200).json({
        success: true,
        data: {url: gopayResponse.gw_url}
    });
}

/**
 * Initializes the service.
 * @param router Express router.
 */
function init(router) {
    requireEnv("HOST_URL");
    requireEnv("GOPAY_URL");
    requireEnv("GOPAY_CLIENT_ID");
    requireEnv("GOPAY_CLIENT_SECRET");
    requireEnv("GOPAY_ALLOWED_SWIFTS");
    requireEnv("GOPAY_GOID");

    gopay.clientId = process.env.GOPAY_CLIENT_ID;
    gopay.clientSecret = process.env.GOPAY_CLIENT_SECRET;
    gopay.allowedSwifts = process.env.GOPAY_ALLOWED_SWIFTS.split(",");
    gopay.goid = process.env.GOPAY_GOID;

    router.use("/init", express.json());
    router.get(notificationPath, async (req, res) => {
        const id = req.query.id;
        const status = await gopay.fetchTransactionStatus(id);
        activeTransactions[id] = status; // TODO: Clear PAID transactions

        if (status === "PAID" && transactionCSIds[id]) {
            const csId = transactionCSIds[id];
            delete transactionCSIds[id];
            delete activeTransactions[id];

            const rawBody = `{"type":"paid","transactionId":"${csId}"}`;
            const hash = digestBody(rawBody);

            await fetch("https://api.craftingstore.net/callback/custom", {
                method: "post",
                headers: {
                    "X-Signature": hash,
                },
                body: rawBody
            });
        }
    });
}

module.exports = {
    init: init,
    handle: incomingStoreRequest,
}
