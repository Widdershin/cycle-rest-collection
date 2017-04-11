import xs from 'xstream';
declare function RestCollection(component: any, sources: any, endpoint: any): {
    HTTP: xs<{
        type: string;
    } | {
        type: string;
        url: any;
        category: string;
    }>;
    pluck: (selector: any) => any;
    merge: (selector: any) => any;
};
export { RestCollection };
