'use strict';

const jsonpointer = require('jsonpointer');
const lodash = require('lodash');

module.exports = {
    byId(ids, request) {
        const response = { resource: {} };

        for (const requestedField of request.fields) {
            jsonpointer.set(
                response.resource, requestedField, requestedField);
        }

        for (const { type, id } of ids.slice(0, -1)) {
            response.resource[`${type}Id`] = id;
        }

        response.resource.id = ids[ids.length - 1].id;
        response.resource.extra = 'something extra';

        return response;
    },
    list(order, direction, after, before, limit = 3, request) {
        let start;
        if (before) {
            start = before - limit;
        }
        else {
            if (after === undefined) {
                after = -1;
            }

            start = after + 1;
        }

        const response = {
            next: `${start + limit - 1}`,
            previous: `${start}`,
            resources: []
        };

        for (let i = start; i < start + limit; i++) {
            const r = {};
            response.resources.push(r);


            for (const requestedField of request.fields) {
                jsonpointer.set(r, requestedField, requestedField);
            }

            r.id = `${i}`;
            r.extra = 'something extra';
        }

        return response;
    }
};
