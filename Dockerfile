# Stardrive — the API + Workbench + marketing site, one zero-dependency
# Node service (node:http is the whole stack; no npm install needed). The
# vendored d4 engine (vendor/d4) ships in the image so builds are hermetic.
FROM node:22-slim

WORKDIR /app
COPY . .

# Runtime state lives on a mounted volume (never in the image).
ENV NODE_ENV=production \
    PORT=8080 \
    STARDRIVE_ENGINE=real \
    STARDRIVE_VAR_DIR=/data \
    STARDRIVE_SECURE_COOKIES=1
VOLUME ["/data"]
EXPOSE 8080

# Secrets are provided at run time, never baked in:
#   STARDRIVE_SECRET          (required in prod — encrypts stored hosting tokens)
#   STARDRIVE_LLM_KEY         (turns the Template Studio on)
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PLAN>  (billing)
#   RESEND_API_KEY, STARDRIVE_EMAIL_FROM, STARDRIVE_LEADS_TO       (email)
CMD ["node", "services/api/server.mjs"]
