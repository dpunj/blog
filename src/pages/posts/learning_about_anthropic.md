---
layout: ../../layouts/MarkdownPostLayout.astro
title: Using tools with Claude
pubDate: 2024-07-01
description: 'This will be a recap of my learnings on using tools with LLMs like Claude.'
author: 'divesh punjabi'
image:
    url: 'https://docs.astro.build/assets/rose.webp'
    alt: 'The Astro logo on a dark background with a pink glow.'
tags: ["llms"]
---
## What are we trying to solve?

We need to get to a point where an LLM like Claude can sell on behalf of restaurants at scale. To start, the LLM will be used to take orders from customers via messaging apps, and it'll use tools to collect the order and notify the restaurant.

## Defining the tools

The LLM will be used to collect all necessary details from customers (e.g., name, address, phone number, etc.), including order details (e.g., items, quantity, delivery address, etc.), to then notify the restaurant so they can prepare their order for pickup for the purposes of our pilot.