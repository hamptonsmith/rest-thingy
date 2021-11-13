'use strict';

const jsonpointer = require('jsonpointer');

const { URLSearchParams } = require('url');

module.exports = class Relaxation {
    middleware = [];

    constructor(spec, drivers) {
        this.spec = spec;
        this.drivers = drivers;

        this.resources = {};
        for (const [key, resourceSpec] of Object.entries(spec)) {
            this.resources[key] = {
                fields: compileFields(resourceSpec.fields || {})
            }
        }
    }

    async process({ method, path, queryString = '' }) {
        if (method !== 'GET') {
            throw new Error();
        }

        if (!path.startsWith('/')) {
            throw new Error('Path must start with /');
        }

        const pathParts = path.split('/').slice(1);

        const resourceType = pathParts[0];
        const resourceSpec = this.spec[resourceType];
        const resourceDriver = this.drivers[resourceType];

        const query = parseQueryString(queryString);

        const rawFields = (query.f
                || [...this.resources[resourceType].fields.default])
                .concat([...this.resources[resourceType].fields.always]);

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
                this.spec[resourceType],
                requestedFields.map(f => decodeJsonPointer(f)));

        const mode = pathParts.length % 2 === 0 ? 'get' : 'list';

        requestedFields.sort();

        const ctx = {
            request: {
                method,
                mode,
                fields: requestedFields,
                fieldsArrayStructure: requestedFieldsArrayStructure,
                resource: [{ type: pathParts[0], id: pathParts[1] }]
            },
            response: {
                status: 404
            }
        };

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
                const clientResponse = await resourceDriver.byId(ctx.request);
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
                const clientResponse = await resourceDriver.list(ctx.request);
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

function populate(target, src, spec) {
    for (const [key, value] of Object.entries(spec)) {
        if (value === true) {
            jsonpointer.set(target, key, jsonpointer.get(src, key));
        }
        else {
            const nextLevel = [];
            jsonpointer.set(target, key, nextLevel);

            for (const el of jsonpointer.get(src, key) || []) {
                const finalEl = {};
                nextLevel.push(finalEl);
                populate(finalEl, el, value)
            }
        }
    }
}

function arrayDestructure(spec, fields) {
    const result = {};

    for (const field of fields) {
        let target = result;
        let level = spec;

        let slice = [];
        for (const component of field) {
            if (level.array) {
                target[encodeJsonPointer(slice)] = {};
                target = target[encodeJsonPointer(slice)];
                slice = [];
            }

            slice.push(component);

            level = level.fields[component];
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

    return compiledFields.always.has(specifier)
            || compiledFields.default.has(specifier)
            || compiledFields.byRequest.has(specifier);
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

function compileFields(
    fieldsSpec,
    accum = { always: new Set(), default: new Set(), byRequest: new Set() },
    path = [])
{
    for (const [key, value] of Object.entries(fieldsSpec)) {
        const finalPath = path.concat([ key ]);

        const inclusion = value.inclusion || 'byRequest';

        if (accum[inclusion] === undefined) {
            throw new Error('Invalid inclusion type: ' + inclusion);
        }

        accum[inclusion].add(JSON.stringify(finalPath));

        if (inclusion === 'always') {
            accum.default.add(JSON.stringify(finalPath));
        }

        if (value.fields) {
            accum = compileFields(value.fields, accum, finalPath);
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
