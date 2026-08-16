/**
 * Generate the M-Pesa B2C SecurityCredential.
 *
 * Safaricom requires the B2C initiator password to be RSA-encrypted with
 * their public certificate. Run:
 *
 *   pnpm tsx scripts/gen-mpesa-credential.ts --password "InitiatorPassword123!" --cert ./safaricom.cer
 *
 * - Sandbox certificate: download from the Daraja developer portal
 *   (developer.safaricom.co.ke → API docs → B2C → sandbox certificate).
 *   Default initiator password in sandbox: Safaricom123!
 * - Paste the printed credential into Admin → Website Settings → mpesa.securityCredential
 */
import { publicEncrypt } from "crypto";
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const password = args[args.indexOf("--password") + 1];
const certPath = args[args.indexOf("--cert") + 1];

if (!password || !certPath) {
  console.error("Usage: tsx scripts/gen-mpesa-credential.ts --password <initiator-password> --cert <cert-file>");
  process.exit(1);
}

const cert = readFileSync(certPath);
const encrypted = publicEncrypt(cert, Buffer.from(password));
console.log(encrypted.toString("base64"));
