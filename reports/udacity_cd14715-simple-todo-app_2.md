# 🔍 Code Review Report

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 0/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 3 |
| **High Priority Tests** | 5 |
| **Refactoring Opportunities** | 5 |

## 🎯 Top Recommendations

1. 🚨 **Security**: Fix SQL injection vulnerabilities in all three search functions. Replace string concatenation and template literals with parameterized queries using placeholders ($1, $2, etc.). This is a blocking issue that must be resolved before merge.
   - Files: src/todo.ts

2. 🚨 **Testing**: Add comprehensive test coverage for all three new search functions, including security tests with SQL injection payloads, valid use cases, edge cases (empty strings, long inputs), and authorization tests (verify user isolation in getTodosByUser).
   - Files: src/todo.ts

3. ⚠️ **Type Safety**: Fix type mismatch in searchTodosByStatus - change parameter from string to boolean to match the database schema and Todo interface. Add input validation to all functions to prevent invalid data from reaching the database.
   - Files: src/todo.ts

4. ⚠️ **Refactoring**: Extract common query execution pattern into a reusable helper function that enforces parameterized queries and provides consistent error handling. This will prevent future SQL injection vulnerabilities and reduce code duplication.
   - Files: src/todo.ts

5. 📝 **Performance**: Replace LIKE '%keyword%' query with PostgreSQL full-text search using tsvector and GIN indexes. The current pattern with leading wildcards forces full table scans and will perform poorly on large datasets.
   - Files: src/todo.ts

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 0/100 | **Coverage:** ~0%

#### Issues (10)
  - Line 120: `critical` SQL Injection vulnerability in searchTodos function. The keyword parameter is directly interpolated into the SQL query using template literals without any sanitization or parameterization. An attacker can inject arbitrary SQL by providing input like: ' OR '1'='1' -- to bypass the LIKE filter or use UNION attacks to extract data from other tables.
  - Line 130: `critical` SQL Injection vulnerability in searchTodosByStatus function. The completed parameter is concatenated directly into the SQL query without validation or parameterization. An attacker can inject SQL commands like: '1 OR 1=1 --' or 'true; DROP TABLE todos; --' to manipulate the query or execute destructive commands.
  - Line 139: `critical` SQL Injection vulnerability in getTodosByUser function. The userId parameter is embedded directly into a SQL query with a JOIN using template literals. An attacker can provide input like: ' OR '1'='1' UNION SELECT * FROM users -- to access unauthorized data or extract sensitive information from other tables.

  *...and 7 more*

#### Test Gaps (6)
  - `searchTodos (line 119)` (critical priority)
  - `searchTodosByStatus (line 128)` (critical priority)

  *...and 4 more*

#### Refactoring Opportunities (5)
  - **pattern-improvement**: Extract common query execution pattern into a reusable parameterized query helper. All three functions follow the same pattern: build query, execute, cast result. This violates DRY and makes it easy to introduce SQL injection bugs.
  - **modernize**: Change parameter type from string to boolean and add input validation. The current signature accepts string but the completed field is boolean, causing type mismatches.

  *...and 3 more*

---

*Generated at 2026-11-18T10:29:36.304Z • Duration: 187603ms*
