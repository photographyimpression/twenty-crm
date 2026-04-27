// Shared Twenty CRM GraphQL API helpers.
// Pattern matches scripts/setup-approvals-object.mjs.

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const hasFlag = (flag) => args.includes(flag);

  const url =
    getArg('--url') ||
    process.env.TWENTY_URL ||
    'http://localhost:3000';
  const token = getArg('--token') || process.env.TWENTY_API_TOKEN;
  const limit = getArg('--limit') ? parseInt(getArg('--limit'), 10) : null;
  const dryRun = hasFlag('--dry-run');

  if (!token) {
    console.error('Error: API token required.');
    console.error('Usage: node <script>.mjs --url https://crm.impressionphotography.ca --token YOUR_API_KEY');
    process.exit(1);
  }

  return { url, token, limit, dryRun, args };
};

const buildClient = ({ url, token }) => {
  const metadataUrl = `${url}/metadata`;
  const apiUrl = `${url}/graphql`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const post = async (endpoint, query, variables = {}) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    // Gateway/proxy errors return HTML, not JSON
    if (!res.ok && text.startsWith('<')) {
      throw new Error(`HTTP ${res.status}: server unavailable (gateway error)`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${res.status}: non-JSON response (${text.slice(0, 120)})`);
    }
    if (data.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
    }
    return data.data;
  };

  return {
    metadataQuery: (query, variables) => post(metadataUrl, query, variables),
    apiQuery: (query, variables) => post(apiUrl, query, variables),
  };
};

export const findObjectByName = async (client, nameSingular) => {
  const data = await client.metadataQuery(`
    query {
      objects(paging: { first: 200 }) {
        edges {
          node {
            id
            nameSingular
            namePlural
            fields(paging: { first: 50 }) {
              edges {
                node {
                  id
                  name
                  type
                }
              }
            }
          }
        }
      }
    }
  `);
  const obj = data.objects.edges.find((e) => e.node.nameSingular === nameSingular);
  if (!obj) throw new Error(`Object "${nameSingular}" not found in metadata.`);
  return obj.node;
};

export const createField = async (client, { objectMetadataId, name, label, type, description, options, defaultValue }) => {
  const input = {
    objectMetadataId,
    name,
    label,
    type,
    description: description || '',
    isNullable: true,
  };
  if (options) input.options = options;
  if (defaultValue) input.defaultValue = defaultValue;

  const data = await client.metadataQuery(`
    mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) {
        id
        name
        type
      }
    }
  `, { input: { field: input } });
  return data.createOneField;
};

// Simple throttle: Twenty rate-limits API keys at 100 req/60s (token bucket).
// Once we burst past 100 the bucket stays depleted and retries loop, so we
// pace at 1100ms between mutations (=54/min) to stay comfortably under.
const MIN_MUTATION_DELAY_MS = 1100;
let lastMutationAt = 0;
const throttle = async () => {
  const elapsed = Date.now() - lastMutationAt;
  if (elapsed < MIN_MUTATION_DELAY_MS) {
    await new Promise((r) => setTimeout(r, MIN_MUTATION_DELAY_MS - elapsed));
  }
  lastMutationAt = Date.now();
};

// Public: throttle + retry wrapper for arbitrary mutations (e.g. deletes).
export const throttledMutation = async (fn, label = 'op') => {
  await throttle();
  return withRetry(fn, label);
};

// Retry on rate-limit errors. Start at 70s (full bucket refill) since the
// token bucket stays depleted when we've burst past its limit.
const withRetry = async (fn, label = 'op') => {
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || '';
      if (/Limit reached|LIMIT_REACHED|rate/i.test(msg) && attempt < 6) {
        const wait = attempt === 0 ? 70000 : 90000 + attempt * 15000;
        console.error(`  rate-limit on ${label}, waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (/gateway|HTTP 50\d|server unavailable|fetch failed|ECONN|ETIMED/i.test(msg) && attempt < 6) {
        const wait = 10000 * Math.pow(2, attempt);
        console.error(`  net error on ${label}, waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
};

export const createCompany = async (client, payload) => {
  await throttle();
  return withRetry(async () => {
    const data = await client.apiQuery(`
      mutation CreateOneCompany($data: CompanyCreateInput!) {
        createCompany(data: $data) { id name }
      }
    `, { data: payload });
    return data.createCompany;
  }, `createCompany(${payload.name})`);
};

export const updateCompany = async (client, id, payload) => {
  await throttle();
  return withRetry(async () => {
    const data = await client.apiQuery(`
      mutation UpdateCompany($id: UUID!, $data: CompanyUpdateInput!) {
        updateCompany(id: $id, data: $data) { id }
      }
    `, { id, data: payload });
    return data.updateCompany;
  }, `updateCompany(${id})`);
};

export const createPerson = async (client, payload) => {
  await throttle();
  return withRetry(async () => {
    const data = await client.apiQuery(`
      mutation CreateOnePerson($data: PersonCreateInput!) {
        createPerson(data: $data) { id }
      }
    `, { data: payload });
    return data.createPerson;
  }, `createPerson`);
};

// Paginate through all Companies matching a filter. Pulls up to pageSize per request.
export const findAllCompanies = async (client, { filter = {}, pageSize = 60 } = {}) => {
  const results = [];
  let cursor = null;
  while (true) {
    await throttle();
    const data = await withRetry(async () => client.apiQuery(`
      query FindCompanies($filter: CompanyFilterInput, $first: Int, $after: String) {
        companies(filter: $filter, first: $first, after: $after) {
          edges {
            node {
              id
              name
              domainName { primaryLinkUrl }
              address { addressPostcode addressCity addressStreet1 }
              leadSource
              leadStatus
              industry
              people { edges { node { id } } }
            }
            cursor
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { filter, first: pageSize, after: cursor }), `findCompanies(cursor=${cursor ?? '∅'})`);
    results.push(...data.companies.edges.map((e) => e.node));
    if (!data.companies.pageInfo.hasNextPage) break;
    cursor = data.companies.pageInfo.endCursor;
  }
  return results;
};

export const init = () => {
  const cliArgs = parseArgs();
  const client = buildClient(cliArgs);
  return { ...cliArgs, client };
};
