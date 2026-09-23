FROM gotenberg/gotenberg:8.21.0

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-lohit-beng-bengali \
    fonts-beng \
    fonts-noto-core \
    fonts-noto-ui-core \
    fonts-freefont-ttf \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

USER gotenberg
