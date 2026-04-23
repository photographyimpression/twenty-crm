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
  const apiUrl = `${url}/api/graphql`;
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
    const data = await res.json();
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
            fields(paging: { first: 200 }) {
              edges {
                node {
                  id
                  name
                  type
                  options
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

export const createCompany = async (client, payload) => {
  const data = await client.apiQuery(`
    mutation CreateOneCompany($data: CompanyCreateInput!) {
      createCompany(data: $data) { id name }
    }
  `, { data: payload });
  return data.createCompany;
};

export const updateCompany = async (client, id, payload) => {
  const data = await client.apiQuery(`
    mutation UpdateCompany($id: UUID!, $data: CompanyUpdateInput!) {
      updateCompany(id: $id, data: $data) { id }
    }
  `, { id, data: payload });
  return data.updateCompany;
};

export const createPerson = async (client, payload) => {
  const data = await client.apiQuery(`
    mutation CreateOnePerson($data: PersonCreateInput!) {
      createPerson(data: $data) { id }
    }
  `, { data: payload });
  return data.createPerson;
};

// Paginate through all Companies matching a filter. Pulls up to pageSize per request.
export const findAllCompanies = async (client, { filter = {}, pageSize = 60 } = {}) => {
  const results = [];
  let cursor = null;
  while (true) {
    const data = await client.apiQuery(`
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
    `, { filter, first: pageSize, after: cursor });
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
