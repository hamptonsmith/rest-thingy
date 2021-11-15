'use strict';

const jsonpointer = require('jsonpointer');
const Relaxation = require('../../index');
const test = require('ava');

async function echoMiddleware(ids, request) {
    function fillArrayLevel(target, request) {
        for (const [key, value] of Object.entries(request)) {
            if (value === true) {
                jsonpointer.set(target, key, key);
            }
            else {
                const nextLevel = {};
                jsonpointer.set(target, key, [nextLevel]);
                fillArrayLevel(nextLevel, value);
            }
        }

        target.extra = 'something extra';
    }

    const response = {
        resource: {}
    };

    fillArrayLevel(response.resource, request.fieldsArrayStructure);

    return response;
}

test('GET top level resource, default fields', async t => {
    const relax = new Relaxation({
        widgets: {
            fields: {
                bar: {
                    fields: {
                        bazz: {
                            array: true,
                            fields: {
                                plugh: {
                                    fields: {
                                        waldo: {
                                            inclusion: 'default'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }, {
        widgets: {
            byId: echoMiddleware
        }
    });

    t.deepEqual(
        await relax.process({ method: 'GET', path: '/widgets/w1' }),
        {
            status: 200,
            headers: {},
            body: {
                bar: {
                    bazz: [
                        {
                            plugh: { waldo: '/plugh/waldo' }
                        }
                    ]
                }
            }
        }
    );
});
