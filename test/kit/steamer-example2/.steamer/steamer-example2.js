module.exports = {
    files: [
        "src",
        "tools",
        "config",
        "README.md",
        ".eslintrc.js",
        ".stylelintrc.js",
        ".gitignore",
    ],
    options: [
        {
            type: 'input',
            name: 'webserver',
            message: 'html url(//localhost:9000/)'
        },
        {
            type: 'input',
            name: 'cdn',
            message: 'cdn url(//localhost:8000/)'
        },
        {
            type: 'input',
            name: 'port',
            message: 'development server port(9000)'
        },
        {
            type: 'input',
            name: 'route',
            message: 'development server directory(/news/)'
        }
    ]
};
