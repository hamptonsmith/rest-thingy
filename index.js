'use strict';

const jsonpointer = require('jsonpointer');

const { URLSearchParams } = require('url');

module.exports = class Relaxation {
    middleware = [];

    constructor(spec) {
        this.spec = spec;

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

        if (!pathParts[1]) {
            throw new Error();
        }

        requestedFields.sort();

        const ctx = {
            request: {
                method,
                fields: requestedFields,
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

        if (method === 'GET' && ctx.response.status === 200) {
            const clientBody = ctx.response.body;
            ctx.response.body = {};

            for (const requestedField of requestedFields) {
                jsonpointer.set(ctx.response.body, requestedField,
                        jsonpointer.get(clientBody, requestedField));
            }
        }

        return ctx.response;
    }

    use(mw) {
        this.middleware.push(mw);
    }
};

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
