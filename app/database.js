const {requireEnv} = require("./util");
const log = require("./log");
const mysql = require("mysql");
const DB_TYPES = {};

let db;
let reg;

module.exports.register = reg = (type, db) => DB_TYPES[type] = db;
module.exports.get = async () => {
    if (!db) {
        const type = requireEnv("DATA_SOURCE");
        if (!DB_TYPES[type])
            throw new Error(`Unknown data source type: ${type}`);

        db = DB_TYPES[type];

        function complete() {
            log.info(`Initialized ${type} as data source.`);
            return db;
        }

        const initResult = db.init(db);
        if (initResult.then) return initResult.then(complete).catch(err => {
            log.error(`Failed to initialize data source ${type}: ${err}`);
        });
        else return Promise.resolve(complete());
    }

    return Promise.resolve(db);
}

reg("mysql", {
    connection: null,
    savePaymentModel: async (model) => {
        return await this.db.query(`INSERT INTO payment_records (gp_id, cs_id) VALUES ('${model.gp_id}', '${model.cs_id}');`);
    },
    getPaymentModel: async (gpId) => {
        const results = await this.db.query(`SELECT * FROM payment_records WHERE gp_id = '${gpId}' LIMIT 1;`);
        return results.length > 0 ? results[0] : undefined;
    },
    query: (q) => {
        if (!this.db.connection)
            throw new Error("MySQL: Not connected to database!");
        return new Promise((resolve, reject) => this.db.connection.query(q, (err, res) => {
            if (err) reject(err);
            else resolve(res);
        }));
    },
    init: (_db) => {
        this.db = _db;
        const host = requireEnv("MYSQL_HOST");
        const port = Number(requireEnv("MYSQL_PORT"));
        const user = requireEnv("MYSQL_USER");
        const password = requireEnv("MYSQL_PASSWORD");
        const database = requireEnv("MYSQL_DATABASE");

        log.info(`MySQL: Initializing connection with ${host}:${port}...`);

        const connection = this.db.connection = mysql.createConnection({
            host, port, user, password, database
        });

        return new Promise((resolve, reject) => {
            log.info(`MySQL: Connecting to database...`);
            connection.connect((err) => {
                if (err) {
                    reject(err);
                } else {
                    log.info(`MySQL: Connected to database.`);
                    this.db.query(`CREATE TABLE IF NOT EXISTS payment_records (id INTEGER PRIMARY KEY AUTO_INCREMENT, gp_id VARCHAR(64) NOT NULL, cs_id VARCHAR(64) NOT NULL);`)
                        .then(() => resolve())
                        .catch((err) => {
                            reject(err);
                            this.log.error(`MySQL: Failed to create table: ${err}`);
                            process.exit(1);
                        });
                }
            });
        })
    }
})
