// Must be imported first: points every test at its own database, never the dev database.
process.env.DB_NAME = process.env.TEST_DB_NAME || "superfix_test";
