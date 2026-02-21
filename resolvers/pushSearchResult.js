export function request(ctx) {
    return {
    
    };
}

export function response(ctx) {
    return {
        status: ctx.arguments.status,
        message: ctx.arguments.message,
        results: ctx.arguments.results
    }
}
