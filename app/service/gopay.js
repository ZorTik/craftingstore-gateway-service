const express = require("express");
const requireEnv = require("../util").requireEnv;
const notificationPath = "/notification";
const returnPath = "/return";
const gopayApiUrl = "https://gw.sandbox.gopay.com";
const gopay = {
    hostUrl: "",
    clientId: "",
    clientSecret: "",
    clientToken: "",
    tokenExpires: 0,
    allowedInstruments: [],
    allowedSwifts: [],
    goid: "",
    /**
     * Fetches new token from GoPay.
     * @returns {Promise<void>} Nothing.
     */
    async fetchNewToken() {
        const fetch = require("node-fetch");
        const res = await fetch(gopayApiUrl + "/api/oauth/token", {
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
    /**
     * Prepares fetch request for GoPay. (Adds authorization header)
     * @param fetchInit Fetch init.
     * @returns {Promise<*>} Same fetch init.
     */
    async prepareGopayRequest(fetchInit) {
        if (Date.now() > this.tokenExpires) {
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
        const payer = {
            allowed_payment_instruments: this.allowedInstruments,
            default_payment_instrument: this.allowedInstruments[0],
            allowed_swifts: this.allowedSwifts,
            default_swift: this.allowedSwifts[0],
            contact: {
                // TODO: From csRequest
            }
        }
        const target = {type: "ACCOUNT", goid: this.goid};
        return fetch(gopayApiUrl + "/api/payments/payment", await this.prepareGopayRequest({
            method: "post",
            body: JSON.stringify({
                payer: payer,
                target: target,
                items: [{
                    type: "ITEM",
                    name: csRequest.package.name,
                    amount: csRequest.package.price,
                    count: 1,
                    vat_rate: "21", // TODO: Calculate optionally
                    ean: 0, // TODO: ???
                    product_url: "" // Not in the request?
                }], // TODO: Items
                amount: csRequest.package.price,
                currency: csRequest.currency,
                order_number: "", // TODO: Order number
                order_description: "",
                callback: {
                    return_url: this.hostUrl + returnPath,
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
function incomingStoreRequest(request, response) {
    // TODO: Create new payment
    // TODO: Handle request from CS

    // TODO: Return in format:
    // {
    //   "success": true,
    //   "data": {
    //     "url": "https://api.example.com/payment/init.php"
    //   }
    // }
}

/**
 * Initializes the service.
 * @param router Express router.
 */
function init(router) {
    requireEnv("HOST_URL");
    requireEnv("GOPAY_CLIENT_ID");
    requireEnv("GOPAY_CLIENT_SECRET");
    requireEnv("GOPAY_ALLOWED_INSTRUMENTS");
    requireEnv("GOPAY_ALLOWED_SWIFTS");
    requireEnv("GOPAY_GOID");

    gopay.clientId = process.env.GOPAY_CLIENT_ID;
    gopay.clientSecret = process.env.GOPAY_CLIENT_SECRET;
    gopay.allowedInstruments = process.env.GOPAY_ALLOWED_INSTRUMENTS.split(",");
    gopay.allowedSwifts = process.env.GOPAY_ALLOWED_SWIFTS.split(",");
    gopay.goid = process.env.GOPAY_GOID;

    router.use("/init", express.json());
    router.use(returnPath, (req, res) => {
        // TODO: Redirect to CraftingStore & notify finish
    });
    router.post(notificationPath, (req, res) => {
        // TODO: Mark payment changes
    });
    // TODO: Init routes
}

module.exports = {
    init: init,
    handle: incomingStoreRequest,
}
