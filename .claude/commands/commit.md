---
description: Stage all changes, analyze them, and create a detailed conventional commit
tags: [git, commit]
---

# Commit Command

You are about to create a git commit with all staged and unstaged changes.

## Workflow

1. **Stage all changes**:
   ```bash
   git add .
   ```

2. **Analyze changes** by running in parallel:
   - `git status` - See all files that will be committed
   - `git diff --staged` - See the actual code changes
   - `git log -1 --format='%s'` - See the last commit message for style reference

3. **Analyze the changes**:
   - Identify the primary purpose (new feature, bug fix, refactor, docs, etc.)
   - Group related changes together
   - Note any breaking changes
   - Identify the scope (which component/package is affected)

4. **Draft commit message** following Conventional Commits format:

   ```
   <type>(<scope>): <subject>

   <body>

   <footer>
   ```

   **Types**:
   - `feat`: New feature
   - `fix`: Bug fix
   - `docs`: Documentation only
   - `style`: Formatting, missing semicolons, etc (no code change)
   - `refactor`: Code change that neither fixes a bug nor adds a feature
   - `perf`: Performance improvement
   - `test`: Adding or updating tests
   - `chore`: Build process, dependencies, tooling
   - `ci`: CI/CD changes

   **Subject**:
   - Use imperative mood ("add" not "added" or "adds")
   - Don't capitalize first letter
   - No period at the end
   - Max 50 characters

   **Body**:
   - Explain what and why (not how)
   - Wrap at 72 characters
   - Separate from subject with blank line
   - Use bullet points for multiple items

   **Footer** (optional):
   - Breaking changes: `BREAKING CHANGE: description`
   - Issue references: `Closes #123` or `Fixes #456`

5. **Show the commit message** to the user for review

6. **Create the commit** using a HEREDOC for proper formatting:
   ```bash
   git commit -m "$(cat <<'EOF'
   <your commit message here>
   EOF
   )"
   ```

7. **Verify the commit** was created successfully:
   ```bash
   git log -1 --stat
   ```

## Important Notes

- **DO NOT PUSH** - Only create the commit, don't push to remote
- If changes span multiple concerns, suggest splitting into multiple commits
- If unsure about the type or scope, ask the user for clarification
- Check for sensitive data (API keys, passwords) before committing

## Example Output

```
feat(provider): add Alpha Vantage, Polygon, and FMP provider implementations

Implement pluggable provider abstraction with three concrete providers:
- Alpha Vantage: Free tier provider for amateur users
- Polygon: Professional tier with real-time data
- Financial Modeling Prep: Quantitative tier for algo trading

Changes include:
- StockProvider interface with GetQuote, GetQuotes, Name, HealthCheck
- Provider registry with factory pattern for dynamic provider creation
- Standardized Quote normalization (dollars, int64 volumes, UTC timestamps)
- Rate limiting, retry, and circuit breaker middleware
- Contract tests for interface compliance
- Engine refactored to accept StockProvider interface
```

## User Input

Process `$ARGUMENTS` if provided:
- If user provides a commit message, use it instead of auto-generating
- If user provides `--amend`, amend the last commit
- If user provides `--no-verify`, skip git hooks
