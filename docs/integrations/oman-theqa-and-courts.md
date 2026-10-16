# Oman digital identity (THEQA) and court integration: plan

Status: planning only. Nothing here is built. All points come from notes the owner shared on October 16, 2026, and must be confirmed with the Ministry of Transport, Communications and Information Technology (MTCIT) and the Supreme Judicial Council before any work starts.

## 1. THEQA (ثقة), Oman's mobile digital identity

What the owner's notes say THEQA offers (to confirm with MTCIT):

- reading the Omani civil ID or resident card through the phone's NFC sensor;
- signing in to government and private e-services without a card reader;
- certified electronic signatures for documents and contracts;
- face verification during onboarding;
- Arabic and English.

What it would mean for TrustiqLegal:

- **Signatures**: today the app records a typed or drawn signature with an audit trail. A THEQA signature would be a certified signature linked to the national PKI, which is much stronger evidence in Omani courts. It would sit next to the current method as a choice when sending for signature.
- **Client onboarding (KYC)**: reading the civil ID chip would fill and verify the client's identity details instead of a photo upload.
- **Sign in**: lawyers and clients could sign in with THEQA.

Questions for MTCIT before any build:

1. Does THEQA offer an integration programme (an SDK or API) for private software companies, or only for government entities and banks?
2. What agreement, fees and security review are needed?
3. Is a test environment available?
4. What does the signed output look like (PAdES PDF signature, a detached signature, or a server-side record), and how is it verified later?

## 2. Court integration (Supreme Judicial Council)

The owner's notes say:

- there is no public open API for the courts;
- integration goes through the government integration platform run by MTCIT, with approval from the Supreme Judicial Council or the Ministry of Justice and Legal Affairs;
- access is limited to government bodies and approved entities, which may include law firms;
- identity and signatures would go through the national PKI;
- connections may need a private network link (MPLS or an approved VPN) rather than the public internet;
- security testing by the Omani authorities comes before production access.

One point in the notes looks wrong and must not be relied on: they mention aligning with "Najiz e-services". Najiz is Saudi Arabia's Ministry of Justice platform, not Oman's.

Proposed order of work, once access is confirmed:

1. Write to the Supreme Judicial Council and MTCIT describing the uses: case status lookup, hearing dates, and later filing. Ask what a law firm's software provider can be approved for.
2. Agree the data each use needs and map it to TrustiqLegal's cases, hearings and court roll.
3. Build a separate connector service so the main app never holds network credentials for the government link.
4. Complete the security review and penetration test that the authorities require.
5. Start with read-only case status and hearing dates; filing only later.

## 3. Dependencies on other roadmap items

- Hosting customer data in Oman (see the GCC roadmap report) will very likely be required before any government integration is approved.
- An information security certification (ISO 27001) will likely be asked for during the security review.
