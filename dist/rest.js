"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var xstream_1 = require("xstream");
var isolate_1 = require("@cycle/isolate");
function always(stream) {
    return xstream_1.default.create({
        start: function (listener) {
            stream.addListener({
                next: function (ev) {
                    listener.next(ev);
                }
            });
        },
        stop: function () { }
    });
}
function memoize(f, remember) {
    if (remember === void 0) { remember = true; }
    return function (selector) {
        var cache = {};
        function sink(item) {
            if (item._id in cache) {
                return cache[item._id];
            }
            var stream = selector(item);
            if (remember) {
                stream = stream.remember();
            }
            cache[item._id] = stream;
            return stream;
        }
        return f(sink);
    };
}
function loadComponent(state, componentData) {
    var componentState$ = componentData.state$;
    var id = componentData.id;
    if (id === null || id === undefined) {
        id = componentData.tempId;
    }
    var instance = isolate_1.default(state.component, state.component.name + "-" + id)(__assign({}, state.sources, componentData));
    instance['_id'] = id;
    return __assign({}, state, { stateSources: __assign({}, state.stateSources, (_a = {}, _a[id] = componentState$, _a)), items: state.items.concat([
            instance
        ]) });
    var _a;
}
function loadComponentsFromIndex(data) {
    return function reduce(state) {
        return data.map(function (v) { return ({ id: v.id, state$: xstream_1.default.of(v) }); }).reduce(loadComponent, state);
    };
}
function addComponent(componentData) {
    return function reduce(state) {
        return loadComponent(state, __assign({}, componentData, { state$: xstream_1.default.merge(componentData.state$, xstream_1.default.never()) }));
    };
}
function applyReducer(state, reducer) {
    return reducer(state);
}
function createRequest(endpoint, name) {
    return function (data) {
        var dataToSend = {};
        Object.keys(data).filter(function (key) { return key !== 'tempId'; }).forEach(function (key) { return dataToSend[key] = data[key]; });
        return {
            method: 'POST',
            url: endpoint,
            tempId: data.tempId,
            send: JSON.stringify((_a = {}, _a[name] = dataToSend, _a)),
            category: 'create'
        };
        var _a;
    };
}
function createSuccess(data) {
    return function reduce(state) {
        var stateSource = state.stateSources[data.tempIdToUpdate];
        stateSource.shamefullySendNext(data.body);
        delete state.stateSources[data.tempIdToUpdate];
        return __assign({}, state, { stateSources: (_a = {},
                _a[data.body.id] = stateSource,
                _a), items: state.items });
        var _a;
    };
}
function updateRequest(endpoint, name) {
    return function (data) {
        return {
            url: endpoint + "/" + data.id,
            method: 'PUT',
            send: JSON.stringify((_a = {}, _a[name] = data, _a)),
            category: 'update'
        };
        var _a;
    };
}
function makeIder() {
    var i = 0;
    return function getId() {
        return "temp-" + i++;
    };
}
var id = makeIder();
function tempId() {
    var tempId = id();
    return function (state) {
        return __assign({}, state, { tempId: tempId });
    };
}
function RestCollection(component, sources, endpoint) {
    var add$ = sources.add$ || xstream_1.default.empty();
    var addWithTemporaryId$ = add$.map(function (a) {
        var applyId = tempId();
        return applyId(__assign({}, a, { state$: a.state$.map(applyId).remember() }));
    });
    var initialRequest = {
        url: endpoint,
        category: 'index'
    };
    var initialState = {
        items: [],
        component: component,
        sources: sources,
        stateSources: {}
    };
    var index$ = sources.HTTP.select('index').flatten().map(function (response) { return response.body; });
    var loadComponentsFromIndex$ = index$.map(loadComponentsFromIndex);
    var createSuccess$ = sources.HTTP.select('create').map(function (response$) {
        var tempIdToUpdate = response$.request.tempId;
        return response$.map(function (data) { return (__assign({}, data, { tempIdToUpdate: tempIdToUpdate })); });
    })
        .flatten()
        .map(createSuccess);
    var addLocalComponent$ = addWithTemporaryId$.map(addComponent);
    var reducer$ = xstream_1.default.merge(loadComponentsFromIndex$, addLocalComponent$.debug('hi'), createSuccess$);
    var state$ = reducer$.fold(applyReducer, initialState);
    var items$ = state$.map(function (state) { return state.items; }).debug('components');
    var merge = memoize(function (selector) {
        return items$
            .map(function (items) { return items.map(selector); })
            .map(function (streams) { return xstream_1.default.merge.apply(xstream_1.default, streams); })
            .flatten();
    }, false);
    var pluck = memoize(function (selector) {
        return items$
            .map(function (items) { return items.map(selector); })
            .map(function (selectedItems) { return xstream_1.default.combine.apply(xstream_1.default, selectedItems); })
            .flatten();
    });
    var update$ = merge(function (item) {
        return item.state$
            .drop(1)
            .compose(sources.Time.debounce(300))
            .map(updateRequest(endpoint, component.name.toLowerCase()));
    });
    var request$ = xstream_1.default.merge(xstream_1.default.of(initialRequest), update$, addWithTemporaryId$
        .map(function (add) { return add.state$.take(1); })
        .flatten()
        .map(createRequest(endpoint, component.name.toLowerCase())));
    return {
        HTTP: request$.map(function (req) { return (__assign({}, req, { type: 'application/json' })); }),
        pluck: pluck,
        merge: merge
    };
}
exports.RestCollection = RestCollection;
