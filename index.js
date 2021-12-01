'use strict';

const jsonpointer = require('jsonpointer');
const util = require('util');

const { URLSearchParams } = require('url');

const metaSpec = {
    r8nschema: {
        singleton: true,

        definitions: {
            linkArray: {
                inclusion: 'default'
            }
        },

        fields: {
            rootLinks: { $ref: '/r8nschema/definitions/linkArray' }
        },

        resources: {
            types: {
                id: 'r8nschema.types',
                fields: {
                    id: { inclusion: 'default' },

                    // A field within "types" called "fields"
                    fields: {
                        inclusion: 'default'
                    },

                    // A field within "types" called "links"
                    links: { $ref: '/r8nschema/definitions/linkArray' }
                }
            }
        }
    }
};

const metaDrivers = {
    r8nschema: {
        byId: (id, request, { apiSpecification }) => ({
            resource: {
                rootLinks: Object.entries(apiSpecification)
                    .map(([key, value]) => ({
                        link: key,
                        type: value.id || key
                    }))
            },
            status: 200
        })
    },
    'r8nschema.types': {
        list: (
            orderName = 'alphabetical',
            orderDirection = 'asc',
            after,
            before,
            limit = 50,
            request,
            {
                apiSpecification,
                typeSpecifications
            }
        ) => {
            let result;
            if (after >= before) {
                result = {
                    resources: [],
                    status: 200
                };
            }
            else {
                const resources = Object.entries(typeSpecifications);

                const ordering = orderDirection === 'desc'
                        ? ([a], [b]) => a > b ? 1 : a < b ? -1 : 0
                        : ([a], [b]) => a < b ? 1 : a > b ? -1 : 0;

                resources.sort(ordering);

                let hasNext = false;
                let hasPrevious = false;

                if (after !== undefined) {
                    while (resources.length > 0
                            && ordering(resources[0], [after]) <= 0) {
                        resources.shift();
                        hasPrevious = true;
                    }
                }

                if (before !== undefined) {
                    while (resources.length > 0 && ordering(
                            resources[resources.length - 1], [before]) >= 0) {
                        resources.pop();
                        hasNext = true;
                    }
                }

                while (resources.length > 0 && resources.length > limit) {
                    resources.pop();
                    hasNext = true;
                }

                result = {
                    resources: resources.map(([id, value]) => {
                        const fields = [];

                        console.log('value', util.inspect(value, false, null, true));
                        console.log('spec', typeSpecifications[id]);

                        return {
                            id,
                            fields: Object.fromEntries(
                                    Object.entries(value.fields.schema || {})
                                    .map(([key, value]) =>
                                            ([key, rehydrateResourceSchema(
                                                    value,
                                                    apiSpecification)]))),
                            links: value.links || {}
                        };
                    })
                };

                if (hasPrevious) {
                    result.hasPrevious = true;
                    result.previous = resources[0][0];
                }

                if (hasNext) {
                    result.hasNext = true;
                    result.next = resources[resources.length - 1][0];
                }
            }

            return result;
        }
    }
};

module.exports = class Relaxation {
    middleware = [];

    constructor(spec, drivers) {
        this.spec = { ...spec, ...metaSpec };
        this.drivers = { ...drivers, ...metaDrivers };

        this.resources = compileResourcesSpec(this.spec);
    }

    async process({ method, path, queryString = '' }) {
        if (method !== 'GET') {
            throw new Error();
        }

        if (!path.startsWith('/')) {
            throw new Error('Path must start with /');
        }

        const pathParts = path.split('/').slice(1);
        const links = [];

        let subResources = this.spec;
        let resourceSpec;
        while (pathParts.length > 0) {
            const currentLinkName = pathParts.shift();
            console.log('currentLinkName', currentLinkName);

            resourceSpec = subResources[currentLinkName];
            console.log('resourceSpec', resourceSpec);

            if (resourceSpec.$ref) {
                resourceSpec = jsonpointer.get(this.spec, resourceSpec.$ref);
            }

            const link = { type: resourceSpec.id || currentLinkName };

            if (resourceSpec.singleton) {
                link.id = currentLinkName;
            }
            else {
                if (pathParts.length > 0) {
                    link.id = pathParts.shift();
                }
            }

            subResources = resourceSpec.resources;

            links.push(link);
        }

        const resourceType = links[links.length - 1].type;
        const resourceId = links[links.length - 1].id;   // Could be undefined
        const resourceDriver = this.drivers[resourceType];

        const query = parseQueryString(queryString);

        const rawFields = (query.f
                || [...this.resources[resourceType].fields.inclusion.default])
                .concat([...this.resources[resourceType].fields.inclusion.always]);

        console.log('rawFields', rawFields);

        const requestedFields = [...new Set(rawFields
                .map(f => {
                    let result;

                    f = f.trim();

                    try {
                        result = JSON.parse(f);
                    }
                    catch (e) {
                        result = f.split('.');
                    }

                    if (!Array.isArray(result)) {
                        throw new Error('Not an array? ' + f);
                    }

                    if (!result.every(el => typeof el === 'string')) {
                        throw new Error('Field specifier contains non-string '
                                + 'element? ' + f);
                    }

                    return result;
                })
                .map(fs => fs.map(
                        f => f.replace(/\~/g, '~0').replace(/\//g, '~1')))
                .map(fs => '/' + fs.join('/'))
                .filter(f =>
                        doesSpecify(this.resources[resourceType].fields, f)))];

        const requestedFieldsArrayStructure = arrayDestructure(
                resourceSpec,
                this.spec,
                requestedFields.map(f => decodeJsonPointer(f)));

        console.log('requestedFieldsArrayStructure', requestedFieldsArrayStructure);

        const mode = resourceId === undefined ? 'list' : 'get';

        requestedFields.sort();

        delete query.f;

        const ctx = {
            request: {
                fields: requestedFields,
                fieldsArrayStructure: requestedFieldsArrayStructure,
                method,
                mode,
                query,
                resource: links
            }
        };

        const aux = {
            apiSpecification: this.spec,
            drivers: this.drivers,
            typeSpecifications: this.resources
        }

        let next = () => Promise.resolve();

        for (let i = this.middleware.length - 1; i > 0; i--) {
            next = async () => {
                await next(ctx, next);
            };
        }

        if (this.middleware.length > 0) {
            await this.middleware[0](ctx, next);
        }

        switch (mode) {
            case 'get': {
                console.log('fields', ctx.request.fields);

                const clientResponse = await resourceDriver.byId(
                        ctx.request.resource, ctx.request, aux);

                console.log('response', util.inspect(clientResponse, false, null, true /* enable colors */));

                if (clientResponse.status === undefined) {
                    clientResponse.status = 200;
                }

                if (!`${clientResponse.status}`.startsWith('2')) {
                    const e = new Error('Did not return a 2xx status.');
                    e.response = clientResponse;
                    throw e;
                }

                const frameworkResponse = {
                    body: {},
                    headers: clientResponse.headers || {},
                    status: clientResponse.status
                };

                populate(frameworkResponse.body, clientResponse.resource,
                        requestedFieldsArrayStructure);

                ctx.response = frameworkResponse;

                break;
            }
            case 'list': {
                const after = firstAsInt(query.after);
                delete query.after;

                const before = firstAsInt(query.before);
                delete query.before;

                const limit = firstAsInt(query.limit);
                delete query.limit;

                const [orderName, orderDirection = 'asc'] = query.order || [];
                delete query.order;

                const clientResponse = await resourceDriver.list(
                        orderName,
                        orderDirection === 'asc' ? 1
                                : orderDirection === 'desc' ? -1
                                : undefined,
                        after,
                        before,
                        limit,
                        ctx.request,
                        aux);

                if (clientResponse.status === undefined) {
                    clientResponse.status = 200;
                }

                if (!`${clientResponse.status}`.startsWith('2')) {
                    const e = new Error('Did not return a 2xx status.');
                    e.response = clientResponse;
                    throw e;
                }

                const frameworkResponse = {
                    body: {
                        next: clientResponse.next,
                        previous: clientResponse.previous
                    },
                    headers: clientResponse.headers || {},
                    status: clientResponse.status
                };

                frameworkResponse.body.resources = clientResponse.resources
                        .map(r => {
                            const result = {};

                            populate(result, r, requestedFieldsArrayStructure);

                            return result;
                        });

                ctx.response = frameworkResponse;

                break;
            }
        }

        return ctx.response;
    }

    use(mw) {
        this.middleware.push(mw);
    }
};

function firstAsInt(arr = []) {
    return arr.length > 0 ?
            Number.parseInt(arr[0])
            : undefined;
}

function peekLast(arr) {
    return arr[arr.length - 1];
}

function populate(target, src, spec) {
    for (const [key, value] of Object.entries(spec)) {
        if (value === true) {
            jsonpointer.set(target, key, jsonpointer.get(src, key));
        }
        else {
            const nextLevel = [];
            jsonpointer.set(target, key, nextLevel);

            src = JSON.parse(JSON.stringify(src));

            const subval = jsonpointer.get(src, key) || [];

            if (!Array.isArray(subval)) {
                throw new Error('Field ' + key + ' is marked `array`, but '
                        + 'resolver returned non-array: '
                        + util.format(subval));
            }

            for (const el of subval) {
                const finalEl = {};
                nextLevel.push(finalEl);
                populate(finalEl, el, value);
            }
        }
    }
}

function arrayDestructure(spec, rootSpec, fields) {
    const result = {};

    for (const field of fields) {
        let target = result;
        let level = spec;

        let slice = [];
        for (const component of field) {
            console.log();
            console.log('arrayDestructure', fields);
            console.log('target', target);
            console.log('level', level);
            console.log('component', component);

            if (level.array) {
                const encodedSlice = encodeJsonPointer(slice);
                if (typeof target[encodedSlice] !== 'object') {
                    target[encodedSlice] = {};
                }
                target = target[encodedSlice];
                slice = [];
            }

            slice.push(component);

            level = level.fields[component];

            if (level.$ref) {
                level = jsonpointer.get(rootSpec, level.$ref);
            }
        }

        if (slice.length > 0) {
            target[encodeJsonPointer(slice)] = true;
        }
    }

    return result;
}

function doesSpecify(compiledFields, jsonPointer) {
    const specifier = JSON.stringify(jsonPointer.split('/').slice(1)
            .map(c => c.replace(/\~1/g, '/').replace(/\~0/g, '~')));

    return compiledFields.inclusion.always.has(specifier)
            || compiledFields.inclusion.default.has(specifier)
            || compiledFields.inclusion.byRequest.has(specifier);
}

const referenceObject = {};
function parseQueryString(qs) {
    qs = qs.trim();

    const query = {};
    if (qs.length > 0) {
        const pairs = qs.split('&');

        for (const pair of pairs) {
            const equalIndex = pair.indexOf('=');

            if (equalIndex === -1) {
                throw new Error(`No equal? "${qs}"`);
            }

            const key = pair.substring(0, equalIndex);

            if (referenceObject[key] === undefined) {
                const valueString = pair.substring(equalIndex + 1);
                const values = valueString.split(',')
                        .map(v => decodeURIComponent(v));

                if (!query[key]) {
                    query[key] = [];
                }

                values.forEach(v => query[key].push(v));
            }
        }
    }

    return query;
}

function compileResourcesSpec(
        resourcesSpec, rootSpec = resourcesSpec, accum = {}) {
    for (const [linkName, resourceSpec] of Object.entries(resourcesSpec)) {
        if (!resourceSpec.$ref) {
            const resourceId = resourceSpec.id || linkName;
            if (accum[resourceId]) {
                throw new Error('Duplicate resource type id: ' + resourceId);
            }

            accum[resourceId] = {
                fields: {
                    inclusion: compileFields(resourceSpec.fields, rootSpec),
                    schema: resourceSpec.fields
                },
                links: Object.fromEntries(
                        Object.entries(resourceSpec.resources || {})
                        .map(([key, value]) => [key, value.id || key])),
                singleton: !!resourceSpec.singleton
            };

            compileResourcesSpec(resourceSpec.resources || {}, rootSpec, accum);
        }
    }

    return accum;
}

function compileFields(
    fieldsSpec = {},
    rootSpec,
    accum = { always: new Set(), default: new Set(), byRequest: new Set() },
    path = [])
{
    for (let [key, value] of Object.entries(fieldsSpec)) {
        console.log('key', key);

        const finalPath = path.concat([ key ]);
        const finalPathString = JSON.stringify(finalPath);

        if (value.$ref) {
            value = jsonpointer.get(rootSpec, value.$ref);
        }
        console.log('value', value);

        const inclusion = value.inclusion || 'byRequest';

        if (accum[inclusion] === undefined) {
            throw new Error('Invalid inclusion type: ' + inclusion);
        }

        accum[inclusion].add(finalPathString);

        if (inclusion === 'always') {
            accum.default.add(finalPathString);
        }

        if (value.fields) {
            accum = compileFields(value.fields, rootSpec, accum, finalPath);
        }
    }

    return accum;
}

function encodeJsonPointer(array) {
    return '/' + array
            .map(el => el.replace(/\~/g, '~0').replace(/\//g, '~1'))
            .join('/');
}

function decodeJsonPointer(ptr) {
    return ptr.split('/').slice(1)
            .map(el => el.replace(/\~1/g, '/').replace(/\~0/g, '~'));
}

function rehydrateResourceSchema(resourceSpec, root, path = [], accum = {}) {
    let rehydrated;

    const typeOfResourceSpec = typeof resourceSpec;
    switch (typeOfResourceSpec) {
        case 'object': {
            if (Array.isArray(resourceSpec)) {
                rehydrated = resourceSpec.map((el, i) =>
                        rehydrateResourceSchema(
                                el, root, path.concat([i]), accum));
            }
            else if (resourceSpec === null) {
                rehydrated = null;
            }
            else {
                if (resourceSpec.$ref) {
                    if (accum[resourceSpec.$ref]) {
                        rehydrated = { $ref: accum[resourceSpec.$ref] };
                    }
                    else {
                        rehydrated = jsonpointer.get(root, resourceSpec.$ref);
                        accum[resourceSpec.$ref] = encodeJsonPointer(path);
                    }
                }
                else {
                    rehydrated = {};
                    for (const [key, value] of Object.entries(resourceSpec)) {
                        rehydrated[key] = rehydrateResourceSchema(
                                value, root, path.concat([key]), accum);
                    }
                }
            }
            break;
        }
        case 'boolean':
        case 'number':
        case 'string': {
            rehydrated = resourceSpec;
            break;
        }
        default: {
            throw new Error('Unexpected type: ' + typeoOfResourceSpec);
        }
    }

    return rehydrated;
}
