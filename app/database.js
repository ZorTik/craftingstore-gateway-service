const {requireEnv} = require("./util");
const DB_TYPES = {};

let db;
let reg;

module.exports.register = reg = (type, db) => DB_TYPES[type] = db;
module.exports.get = () => {
    if (!db) {
        const type = requireEnv("DATA_SOURCE");
        if (!DB_TYPES[type])
            throw new Error(`Unknown data source type: ${type}`);

        db = DB_TYPES[type];
        db.init();
        require("./log").info(`Initialized ${type} as data source.`);
    }

    return db;
}

reg("json", {
    fs: require("fs"),
    db: {paymentModels: {}},
    savePaymentModel: (model) => {
        this.db.paymentModels[model.id] = model;
        this.saveJson();
    },
    getPaymentModel: (gpId) => { // GoPay ID
        return this.db.paymentModels[gpId];
    },
    saveJson: () => { // Local
        this.fs.writeFileSync(process.cwd() + "/db.json", JSON.stringify(this.db));
    },
    init: () => {
        this.fs.existsSync(process.cwd() + "/db.json") && (this.db = JSON.parse(`${this.fs.readFileSync(process.cwd() + "/db.json")}`));
    }
});

reg("mysql", {
    savePaymentModel: (model) => {
        // TODO
    },
    getPaymentModel: (gpId) => {
        // TODO
    },
    init: () => {
        const host = requireEnv("MYSQL_HOST");
        const port = requireEnv("MYSQL_PORT");
        const user = requireEnv("MYSQL_USER");
        const password = requireEnv("MYSQL_PASSWORD");
        const database = requireEnv("MYSQL_DATABASE");


        // TODO
    }
})
