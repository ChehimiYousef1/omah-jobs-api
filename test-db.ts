import sql from "mssql";

const config = {
  user: "omahjobs",
  password: "9s?C!Bc2002!!", // replace with your actual password
  server: "omah-jobs.cfiecgisk108.eu-north-1.rds.amazonaws.com",
  database: "omah-jobs",
  options: {
    encrypt: true, // required for AWS RDS
    trustServerCertificate: true
  },
  port: 1433
};

async function testConnection() {
  try {
    const pool = await sql.connect(config);
    console.log("Connected successfully!");
    pool.close();
  } catch (err) {
    console.error("Connection failed:", err);
  }
}

testConnection();