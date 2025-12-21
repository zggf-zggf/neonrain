# NeonRain Deployment Makefile
.PHONY: help deploy deploy-all deploy-backend deploy-web deploy-discord setup status logs

help:
	@echo "NeonRain Deployment Commands"
	@echo ""
	@echo "  make setup          - Initial Railway project setup"
	@echo "  make deploy         - Deploy all services"
	@echo "  make deploy-backend - Deploy backend only"
	@echo "  make deploy-web     - Deploy web only"
	@echo "  make deploy-discord - Deploy discord-client only"
	@echo "  make status         - View deployment status"
	@echo "  make logs           - View recent logs"
	@echo "  make open           - Open Railway dashboard"

setup:
	@./scripts/setup-railway.sh

deploy deploy-all:
	@./scripts/deploy.sh --all

deploy-backend:
	@./scripts/deploy.sh --service backend

deploy-web:
	@./scripts/deploy.sh --service web

deploy-discord:
	@./scripts/deploy.sh --service discord-client

status:
	@railway status

logs:
	@railway logs

logs-backend:
	@railway logs --service backend

logs-web:
	@railway logs --service web

logs-discord:
	@railway logs --service discord-client

open:
	@railway open

variables:
	@railway variables
