FROM php:8.2-cli-alpine

WORKDIR /app

COPY . /app

# Garante que as pastas existam e tenham permissão total
RUN chmod -R 777 /app/api || true
RUN chmod 666 /app/api/state.json || true

ENV PORT=8000
EXPOSE 8000

# Inicia o servidor embutido do PHP apontando para o router.php e docroot public
CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-8000} -t public router.php"]
