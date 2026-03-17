import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import sql from "mssql";
import { getPool } from "../../config/db";
export const authenticate = async (req, res, next) => {
    try {
        const token = req.cookies?.auth_token;
        if (!token)
            return res.status(401).json({ error: "Not authenticated" });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const pool = await getPool();
        const result = await pool.request()
            .input("userId", sql.UniqueIdentifier, decoded.userId)
            .query(`SELECT id, name, email, role FROM users WHERE id = @userId`);
        if (!result.recordset[0])
            return res.status(401).json({ error: "User not found" });
        req.user = result.recordset[0];
        next();
    }
    catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
};
//# sourceMappingURL=auth.middleware.js.map