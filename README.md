# University Research Papers — Test 2

This assessment demonstrates preparing research paper data in
Databricks Free Edition, storing it in Azure Cosmos DB for NoSQL,
and displaying it through a custom GraphQL API and HTML frontend.

## Data flow

Kaggle dataset → Databricks Free Edition → JSON export and manual
import → Azure Cosmos DB → Apollo GraphQL → Web UI.

See [the architecture diagram](architecture.md).

### Dataset

Source: [Articles Classification Dataset on Kaggle](https://www.kaggle.com/datasets/fellahabdelnour13/articles-classification-dataset)

The source file, `data.raw.json`, contains 22,134 records.
The notebook selects 50 papers, including the assessment example
paper `5073923`, titled “Investigating Through Fiction”.

### Preparation in Databricks

The exported notebook is `02_University_Papers.ipynb`.

The notebook:

1. Creates the project schema and source-file volume.
2. Loads the multiline JSON dataset.
3. Selects a repeatable sample, prioritising paper 5073923 and
   then sorting by string ID.
4. Normalises whitespace in titles and abstracts.
5. Removes blank, null and duplicate entries from arrays.
6. Maps the source `venue` domain codes to `categories`.
7. Creates `categoryKey` from the first category, using
   `uncategorized` when no category exists.
8. Validates 50 unique IDs and the required document fields.
9. Exports `papers_sample_50.json` and verifies it by reading it back.

The JSON file is downloaded from Databricks and manually imported
through Cosmos DB Data Explorer. This uses the fallback explicitly
allowed by the assessment.

## Cosmos DB configuration

| Setting | Value |
| --- | --- |
| API | Azure Cosmos DB for NoSQL |
| Database | universitydb |
| Container | papers |
| Partition key | /id |
| Throughput | Manual, 400 RU/s |
| Region | West US 2 |
| Sample size | 50 documents |
| Free Tier | Enabled |

Stored document fields are:

- `id`
- `title`
- `abstract`
- `authors`
- `keywords`
- `categories`
- `categoryKey`
- `publicationDate`

## Design choices

### Python and PySpark

The notebook uses Python/PySpark because Scala is not supported
in Databricks Free Edition.

### Databricks → Cosmos DB transfer

**Chosen method: export JSON and insert manually**, which is
an acceptable fallback under the assessment requirements.

The notebook prepares and validates the selected papers in
Databricks, then exports them as `papers_sample_50.json`.
The exported file is read back to verify that its contents
match the 50 prepared documents.

I downloaded this file from the Databricks volume and uploaded
it through Azure Cosmos DB Data Explorer into:

- Database: `universitydb`
- Container: `papers`

This demonstrates that the data stored in Cosmos DB originated
from the preparation performed in Databricks.

I chose this method to work within the Databricks Free Edition
environment and keep the small assessment sample straightforward
to transfer. The preferred Cosmos DB Spark connector was not
used. The transfer is manual rather than automated.

**Verification of successful transfer:**

- The notebook confirmed 50 prepared documents with unique IDs.
- The exported JSON passed the read-back verification.
- The Cosmos DB count query returned 50 documents.
- Paper `5073923` was retrieved from Cosmos DB.
- The GraphQL API and web UI subsequently retrieved that paper.

### Document structure

Each paper is stored as an individual JSON document, with this
field structure:

| Field | Stored type | Purpose |
| --- | --- | --- |
| `id` | String | Paper identifier and partition key value |
| `title` | String | Paper title |
| `abstract` | String or null | Paper abstract |
| `authors` | Array of strings | Authors |
| `keywords` | Array of strings | Keywords |
| `categories` | Array of strings | Category codes mapped from source `venue` |
| `categoryKey` | String | First category, or `uncategorized` |
| `publicationDate` | String or null | Date retained from the source |

The notebook checks that the sample contains exactly 50 unique,
non-empty string IDs, rejects unsupported ID characters,
checks that titles and categoryKey values are present, and
checks that authors, keywords and categories are arrays.

The preparation step removes null, blank and duplicate array
entries. The JSON export contains an array of 50 paper objects;
after import, each object is a separate Cosmos DB document.

### Partition key selection

**Chosen partition key: `/id`.**

I chose `/id` because each paper has a stable, unique identifier
and the assessment explicitly requires retrieving a paper by ID,
such as `5073923`.

With `/id`, the API already knows both values needed for a
Cosmos DB point read: the item ID and the partition key value.
For example:

`container.item("5073923", "5073923").read()`

This retrieves the paper directly without a cross-partition
query. The high-cardinality ID field also avoids grouping many
papers under a small number of category values.

I did not choose `/categoryKey` because an ID-only request
would also need the categoryKey to perform a point read.
In addition, a paper can have multiple categories, while
categoryKey stores only the first source-listed category.

**Trade-off:** listing papers and filtering by category require
cross-partition queries with the chosen `/id` partition key.
This is acceptable for the 50-document assessment sample.
For a larger application dominated by category searches, I
would reassess the partition strategy using the expected
workload and measured request-unit consumption.

The `categoryKey` field remains in each document as a convenience
field, but it is not the container's partition key. It represents
the first source-listed category, not a verified primary category.
Category filtering checks the complete `categories` array.

### Custom GraphQL API

Apollo Server and Express expose a read-only GraphQL API.
The backend uses the Azure Cosmos DB JavaScript SDK.

| Operation | Behaviour |
| --- | --- |
| `paper(id)` | Get one paper by ID; return null if absent |
| `papers(limit)` | List papers ordered by ID |
| `papersByCategory(category, limit)` | Match a category in the categories array |

List limits must be between 1 and 50. Cosmos DB queries use
parameters for category and limit values.

The schema is in [schema.graphql](schema.graphql).
Example operations are in [sample-queries.graphql](sample-queries.graphql).
When executing that file, select one named operation at a time.

### Web UI

The HTML page displays paper IDs, titles and categories.

- Paper ID search uses the `paper` GraphQL operation.
- Category search uses the `papersByCategory` operation.
- Title search filters the retrieved sample in the browser,
  using case-insensitive substring matching.
- Show all retrieves up to 50 papers through GraphQL.

Express serves the page and `/graphql` from the same origin.
Paper values are displayed with `textContent`.

## Run the application in GitHub Codespaces

1. Open the repository in GitHub Codespaces.
2. If using a new Codespace, restore dependencies in its Bash
   terminal with:

   ```bash
   npm ci
   ```

3. Create a `.env` file beside `server.js`:

   ```dotenv
   COSMOS_ENDPOINT=https://YOUR-ACCOUNT.documents.azure.com:443/
   COSMOS_KEY=YOUR_READ_ONLY_KEY
   COSMOS_DATABASE=universitydb
   COSMOS_CONTAINER=papers
   PORT=4000
   ```

4. Enter the Cosmos DB account URI and read-only key privately.
   The database and populated container must already exist.
5. Start the application:

   ```bash
   npm start
   ```

6. Open the forwarded port 4000 in the browser. Keep its
   visibility private for the demonstration.

Endpoints:

- `/` — research paper web page
- `/graphql` — GraphQL API
- `/health` — server status

The health endpoint confirms that the server is running.
A successful paper query confirms access to Cosmos DB.

The `.env` file is excluded from Git. Never include real keys in
the repository, frontend code or submission screenshots.

## Validation performed

- Notebook loaded 22,134 source records.
- Selected sample contains 50 distinct paper IDs.
- Paper 5073923 is present.
- Exported JSON was read back and verified.
- Cosmos DB count query returned 50 documents.
- GraphQL retrieved paper 5073923.
- GraphQL list query returned five papers with `limit: 5`.
- Category query for `shs.geo` returned the expected paper.
- UI searches by ID, title and category displayed the expected result.

Cosmos DB verification queries:

```sql
SELECT VALUE COUNT(1) FROM c
```

```sql
SELECT * FROM c WHERE c.id = "5073923"
```

## Cost controls

- Use Databricks Free Edition within its fair-use limits.
- Store only 50 prepared documents in Cosmos DB.
- Keep manual throughput at 400 RU/s in one region.
- Keep total account throughput and storage within the Cosmos DB
  Free Tier allowance of 1,000 RU/s and 25 GB.
- Avoid adding regions, increasing throughput or enabling paid
  services for this demonstration.
- Run the API and UI in Codespaces rather than provisioning
  additional Azure application hosting.
- Keep Codespaces compute and storage within the personal
  account's included allowances.
- Stop the Codespace when not working. Stopping ends compute
  usage, but its stored files continue to count toward storage usage.
- Check Azure Cost Management and GitHub billing usage before
  submission. Do not enable paid overage for this assessment.

These controls describe the intended no-charge operation.
They do not replace checking actual usage and billing.

Cosmos DB Free Tier is different from an Azure Free Trial
subscription. The subscription previously inspected was labelled
Azure Plan; Azure Free Trial eligibility has not been confirmed.
The Free Trial requirement therefore remains a compliance item
to verify with the assessor.

## Limitations

- This is a demonstration using a deliberately selected sample,
  not a statistically representative sample of all research papers.
- The implementation uses Databricks Free Edition, rather than
  an Azure-provisioned Databricks workspace.
- Data transfer is manual; no scheduled ingestion or incremental
  updates are implemented.
- List results are capped at 50; pagination is not implemented.
- Title search covers only the retrieved sample.
- Category matching is exact and case-sensitive.
- Publication dates are retained as source strings.
- Text cleaning normalises whitespace; it does not remove all
  possible HTML markup from source abstracts.
- The API provides queries only; it does not expose mutations.
- Application-level authentication, rate limiting and GraphQL
  query-complexity controls are not implemented. Demonstration
  access relies on the private Codespaces forwarded port.
- The website and API are available only while the Codespace
  and Node.js server are running.
- Production deployment would require additional security,
  monitoring, scaling and availability measures.

## Submission contents

1. Exported notebook: `02_University_Papers.ipynb`
2. Cosmos DB screenshots showing database/container settings,
   partition key, throughput, inserted documents and record count
3. GraphQL schema: `schema.graphql`
4. Sample queries: `sample-queries.graphql`
5. Architecture diagram: `architecture.md`
6. This README

Supporting source files include `server.js`, `public/index.html`,
`package.json`, `package-lock.json` and `.gitignore`.

## References

- [Databricks Free Edition limitations](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations)
- [Cosmos DB Free Tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier)
- [GitHub Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
