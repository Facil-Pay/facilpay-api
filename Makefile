.PHONY: dev test migrate logs stop clean

dev:
	docker compose up --build

test:
	docker compose -f docker-compose.test.yml run --rm api-test

migrate:
	docker compose exec api npm run typeorm:migration:run

logs:
	docker compose logs -f api

stop:
	docker compose down

clean:
	docker compose down -v
