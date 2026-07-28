/**
 * Portability artifacts written into every assembled site.
 *
 * "Deploy it anywhere" was already technically true: the output is an ordinary
 * Next.js app, and a git push means any git-based host builds it. But true and
 * unassisted is not the same as usable, and a licensee opening an export to
 * find no Dockerfile and no instructions concludes the opposite.
 *
 * So every site carries its own Dockerfile and its own deploy guide, naming
 * real hosts with real steps. The guide is deliberately honest about the one
 * constraint that actually bites: a site with an admin area or any form is an
 * application, not a folder of files, so it needs somewhere that runs Node.
 * Discovering that on a client's launch day is how a licensee stops trusting
 * the tool.
 */

/** A production Dockerfile for the assembled site. Works on any host that
 *  takes a container: Fly, Railway, Render, Coolify, a plain VPS. */
export function renderDockerfile(siteName = 'site') {
  return `# ${siteName} — production container.
# Build:  docker build -t ${slug(siteName)} .
# Run:    docker run -p 3000:3000 --env-file .env ${slug(siteName)}
#
# Two stages so the shipped image carries the built site and its runtime
# dependencies, not the toolchain that produced them.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
# Next reads NEXT_PUBLIC_* at build time, so a custom domain must be present
# here for canonical URLs and sitemaps to come out right.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
EXPOSE 3000
# Secrets are supplied at run time, never baked into the image. See DEPLOY.md.
CMD ["npm", "start"]
`;
}

const slug = (s) => String(s || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';

/**
 * The deploy guide. `env` is the list of variable NAMES this site needs; no
 * values are ever written here, because this file ships inside the export and
 * frequently ends up in a git repository.
 */
export function renderDeployGuide({ siteName = 'This site', envNames = [], needsNode = true, hasDatabase = false } = {}) {
  const envList = envNames.length
    ? envNames.map((n) => `- \`${n}\``).join('\n')
    : '- (none)';

  return `# Deploying ${siteName}

This is a standard [Next.js](https://nextjs.org) application. It is yours: no
part of it depends on Stardrive, or on any one hosting company. Everything
below is a real, supported way to run it.

## What it needs

${needsNode
    ? `**Somewhere that runs Node.js.** This site has an admin area and server
routes (contact form, and anything else you switched on), so it is an
application rather than a folder of static files. That rules out
static-only hosting such as plain S3, GitHub Pages or basic shared hosting,
and rules in every option listed below.`
    : `**Somewhere that serves files, or runs Node.js.** This build has no admin
area and no server routes, so a static host will do.`}

${hasDatabase
    ? `**A libSQL database.** The admin area stores content in one. Turso is the
easiest hosted option and has a free tier, but any libSQL-compatible endpoint
works, including one you host yourself.`
    : ''}

### Environment variables

Set these wherever you deploy. Every host has a screen for this, usually under
Settings, then Environment Variables.

${envList}

Stardrive can hand you these ready-filled: open the site in the Workbench and
choose **Download .env**. Never commit that file to a repository.

## Option 1: connect a git repository (easiest)

Push this code to GitHub, GitLab or Bitbucket, then point a host at the
repository. It builds on every push from then on, with no further setup.

Works as-is with **Vercel**, **Netlify**, **Cloudflare Pages**, **Render**,
**Railway**, **AWS Amplify**, **DigitalOcean App Platform**, and others. None
of them need any change to this code. Where a build command is requested, it is
\`npm run build\`; the output directory is \`.next\`.

## Option 2: a container (most portable)

A \`Dockerfile\` is included.

\`\`\`
docker build -t ${slug(siteName)} .
docker run -p 3000:3000 --env-file .env ${slug(siteName)}
\`\`\`

That image runs on **Fly.io**, **Railway**, **Render**, **Google Cloud Run**,
**AWS App Runner**, **Azure Container Apps**, **Coolify**, **Dokku**, or any
server you own. This is the option with no lock-in of any kind.

## Option 3: a plain server

On any machine with Node.js 20 or newer:

\`\`\`
npm install
npm run build
npm start
\`\`\`

It listens on port 3000. Put nginx, Caddy or your platform's proxy in front for
HTTPS. Keep it running with pm2, systemd, or whatever you already use.

## Moving later

Take the whole folder and start again anywhere on this page. Your content lives
in your database, not in this code, so it moves with you. Nobody can hold your
site hostage, which is the entire point.
`;
}
