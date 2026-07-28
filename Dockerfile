FROM mcr.microsoft.com/playwright:v1.61.1-noble AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/package.json /app/package-lock.json ./
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist
RUN mkdir -p /app/qa-radar-results && chown pwuser:pwuser /app/qa-radar-results

USER pwuser
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/web.js"]
