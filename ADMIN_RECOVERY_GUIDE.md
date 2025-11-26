# Admin Account Recovery Guide

## Overview

If you lose access to your admin account, you can recover it using the recovery mechanism built into the system.

## Recovery Methods

### Method 1: API Recovery (Recommended)

1. **Ensure your `.env` file has:**
   ```env
   ADMIN_EMAIL=your-admin@email.com
   ADMIN_PASSWORD=your-secure-password
   ADMIN_RECOVERY_TOKEN=your-strong-random-token
   ```

2. **Call the recovery endpoint:**
   ```bash
   POST http://localhost:5000/api/admin/recover
   Content-Type: application/json
   
   {
     "recoveryToken": "your-strong-random-token"
   }
   ```

3. **Response:**
   ```json
   {
     "message": "Admin account recovered successfully",
     "admin": {
       "email": "your-admin@email.com",
       "name": "Election Administrator",
       "role": "ADMIN"
     },
     "credentials": {
       "email": "your-admin@email.com",
       "password": "[Set in ADMIN_PASSWORD in .env]"
     }
   }
   ```

4. **Log in with credentials from `.env`**

### Method 2: Seed Script Recovery

1. **Update `.env` file:**
   ```env
   ADMIN_EMAIL=your-admin@email.com
   ADMIN_PASSWORD=your-new-password
   ADMIN_NAME=Your Name
   ```

2. **Run seed script:**
   ```bash
   npm run prisma:seed
   ```

3. **This will:**
   - Reset admin password to `ADMIN_PASSWORD` from `.env`
   - Update admin name to `ADMIN_NAME` from `.env`
   - Keep admin email as `ADMIN_EMAIL` from `.env`

## Security Best Practices

1. **Recovery Token:**
   - Use a strong, random token (at least 32 characters)
   - Store it securely in `.env`
   - Never commit `.env` to version control
   - Example: `ADMIN_RECOVERY_TOKEN=$(openssl rand -hex 32)`

2. **Password:**
   - Use a strong password (12+ characters, mixed case, numbers, symbols)
   - Store in `.env` only
   - Change regularly

3. **Audit Logging:**
   - All recovery attempts are logged
   - Check audit logs if recovery fails
   - Failed attempts are logged with IP address

## Troubleshooting

### "Invalid recovery token"
- Check `ADMIN_RECOVERY_TOKEN` in `.env` matches the token you're sending
- Ensure no extra spaces or quotes in `.env` file

### "Admin credentials not configured"
- Ensure `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set in `.env`
- Restart server after updating `.env`

### Recovery endpoint not working
- Check server is running
- Verify route is registered: `/api/admin/recover`
- Check server logs for errors

## Getting Recovery Instructions

```bash
GET http://localhost:5000/api/admin/instructions
```

Returns detailed instructions and security notes.

## Important Notes

- Recovery resets admin password to `.env` value
- All recovery actions are logged in audit log
- Recovery token should be different from JWT_SECRET
- Keep `.env` file secure and backed up
- Consider having multiple admin accounts for redundancy





