# Contributing to OlivERP

First off, thank you for considering contributing to **OlivERP**! It's people like you that make it a better tool for everyone.

Following these guidelines helps to communicate that you respect the time of the developers managing and developing this open source project. In return, they should reciprocate that respect in addressing your issue, assessing changes, and leveling up the project.

## Table of Contents

- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Pull Requests](#pull-requests)
- [Styleguides](#styleguides)
  - [Git Commit Messages](#git-commit-messages)
  - [TypeScript Styleguide](#typescript-styleguide)
  - [Tailwind CSS Styleguide](#tailwind-css-styleguide)

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

- **Check if the bug has already been reported** by searching the GitHub Issues.
- **Open a new issue** if you can't find an existing one.
- **Use a clear and descriptive title** for the issue.
- **Describe the exact steps to reproduce the problem** in as many details as possible.
- **Explain which behavior you expected to see and why** and what you actually saw.
- **Include screenshots** if the problem is UI-related.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion, including completely new features and minor improvements to existing functionality.

- **Check if there's already a similar suggestion** in the GitHub Issues.
- **Use a clear and descriptive title**.
- **Provide a step-by-step description of the suggested enhancement**.
- **Explain why this enhancement would be useful** to most OlivERP users.

### Pull Requests

1. **Fork the repository** and create your branch from `main`.
2. **If you've added code that should be tested, add tests**.
3. **If you've changed APIs, update the documentation**.
4. **Ensure the test suite passes**.
5. **Make sure your code lints** (`pnpm astro check`).
6. **Submit a Pull Request** with a comprehensive description of your changes.

### Developing with Demo Mode

If you want to contribute to the UI or frontend logic but don't want to set up a Supabase instance, you can use the **Demo Mode**. 

Simply skip step 3 of the installation (skip the `.env` file credentials). The application will detect the absence of credentials and automatically populate the dashboard with realistic mock data, allowing you to develop and test your changes immediately.


## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

### TypeScript Styleguide

- Use TypeScript for all logic.
- Prefer functional components and hooks.
- Define types/interfaces for all data structures (see `src/types/`).
- Use `any` only as a last resort.

### Tailwind CSS Styleguide

- Use Tailwind 4 utility classes (integrated via Vite).
- Avoid writing custom CSS in `.astro` files unless absolutely necessary.
- Use the project's color palette (indigo/emerald/rose accents) to keep the UI consistent.

## Questions?

Feel free to open an issue or reach out to [Oli](https://github.com/martinezharo).

---

Thank you again for your contribution! 🚀
