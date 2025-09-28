#! /bin/bash

/usr/bin/tmux new-session "DOTNET_ENVIRONMENT=development dotnet watch --project GospelPresenter.Web/GospelPresenter.Web.csproj --non-interactive --no-launch-profile --urls=http://0.0.0.0:5253" \; \
  split-window -h "GospelPresenter.Shared/tailwindcss-4.1.13 -i GospelPresenter.Shared/tailwind-input.css -o GospelPresenter.Shared/wwwroot/tailwind-output.css -w" \; \
  attach