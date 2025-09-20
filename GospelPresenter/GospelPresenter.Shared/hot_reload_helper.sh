#!/bin/bash

fswatch -o -r -e ".*" -i ".*\.razor$" . | while read _ ;
do
  echo "A Razor file changed => touch Layout/MainLayout.razor.css => which will trigger a hot reload when tailwind updates the css"
  touch Layout/MainLayout.razor.css
done
