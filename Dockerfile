# First stage: Download supercronic
FROM curlimages/curl AS supercronic

ENV SUPERCRONIC_VERSION=0.2.34
ENV SUPERCRONIC_SHA1SUM_AMD64=e8631edc1775000d119b70fd40339a7238eece14
ENV SUPERCRONIC_SHA1SUM_ARM64=4ab6343b52bf9da592e8b4bb7ae6eb5a8e21b71e

RUN ARCH=$(uname -m) \
    && if [ "$ARCH" = "x86_64" ]; then \
        SUPERCRONIC_URL="https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-amd64"; \
        SUPERCRONIC_SHA1SUM="$SUPERCRONIC_SHA1SUM_AMD64"; \
       elif [ "$ARCH" = "aarch64" ]; then \
        SUPERCRONIC_URL="https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-arm64"; \
        SUPERCRONIC_SHA1SUM="$SUPERCRONIC_SHA1SUM_ARM64"; \
       else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
       fi \
    && curl -fsSL "$SUPERCRONIC_URL" -o /tmp/supercronic \
    && echo "$SUPERCRONIC_SHA1SUM  /tmp/supercronic" | sha1sum -c - \
    && chmod +x /tmp/supercronic

# Main stage: Node.js application
FROM node:24.4.1

# Copy supercronic from first stage
COPY --from=supercronic --chown=node:node /tmp/supercronic /usr/local/bin/supercronic

# Set working directory
WORKDIR /app

# Copy package files
COPY --chown=node:node package*.json ./
COPY --chown=node:node .nvmrc ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY --chown=node:node . .

# Create data directory and set permissions
RUN mkdir -p ./data && chown -R node:node ./data

# Create a crontab file
RUN echo "# This is a placeholder crontab file that will be replaced at runtime" > /app/crontab \
    && chown node:node /app/crontab

# Set permissions for entrypoint script
RUN chmod +x /app/docker-entrypoint.sh

# Install supercronic dependency
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV NODE_ENV=production
ENV ACTUAL_DATA_DIR=./data

# Switch to non-root user
USER node

# Command to run the application
ENTRYPOINT ["/app/docker-entrypoint.sh"]
