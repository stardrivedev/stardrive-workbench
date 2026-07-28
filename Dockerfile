# Stardrive — the API + licensee Console (/workbench/), one zero-dependency
# Node service (node:http is the whole stack; no npm install for the API). The
# vendored d4 engine (vendor/d4) ships in the image so site builds are hermetic.
# npm ships in the base image and is used at runtime to compile client sites in
# the full-QA tier. (The public marketing site is a separate deployment, built
# with Stardrive itself, and is not bundled here.)
FROM node:22-slim

# ca-certificates so outbound HTTPS (model provider, GitHub, npm) works.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Runtime state lives on a mounted volume, never in the image.
ENV NODE_ENV=production \
    PORT=8080 \
    STARDRIVE_ENGINE=real \
    STARDRIVE_QA=full \
    STARDRIVE_VAR_DIR=/data \
    STARDRIVE_SECURE_COOKIES=1
VOLUME ["/data"]
EXPOSE 8080

# Secrets/config are provided at run time, never baked into the image:
#   STARDRIVE_SECRET          (REQUIRED in prod — encrypts stored hosting tokens)
#   STARDRIVE_LLM_KEY         (turns the Template Studio on; provider's key)
#   STARDRIVE_LLM_PROVIDER    (openai | anthropic; default openai)
#   STARDRIVE_COPY_MODEL      (copywriter model; default gpt-5.5)
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PLAN>  (billing)
#   RESEND_API_KEY, STARDRIVE_EMAIL_FROM, STARDRIVE_LEADS_TO       (email)
#   STARDRIVE_OPS_TOKEN       (unlocks GET /v1/ops, the operator's own view)
#   STARDRIVE_ALERT_TO        (watchdog alerts; needs RESEND_API_KEY to send)
# Browser QA sub-checks (axe, screenshot) skip honestly unless Playwright +
# chromium are present; core QA (install → next build → serve → routes) runs
# with npm alone.

# `ok` means the process is answering, and nothing more. A degraded deployment
# (full disk, stalled queue) stays 200 on purpose: restarting the container
# cannot fix a full volume, and a HEALTHCHECK that says otherwise would turn
# one bad condition into a restart loop. `degraded` and /v1/ops carry the rest.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/api/server.mjs"]
