'use strict';

const SteamerPlugin = require('steamer-plugin'),
    path = require('path'),
    url = require('url'),
    ora = require('ora'),
    Rx = require('rx'),
    inquirer = require('inquirer'),
    _ = require('lodash'),
    git = require('simple-git'),
    compareVer = require('compare-versions'),
    spawn = require('cross-spawn');

/**
 * // .steamer/steamer.plugin-kit.js
     module.exports = {
        'plugin': 'steamer-plugin-kit',
        'config': {
            'kit': 'steamer-react'
        }
    }
*/

class KitPlugin extends SteamerPlugin {
    constructor(args) {
        super(args);
        this.argv = args;
        this.pluginName = 'steamer-plugin-kit';
        this.description = 'manage starterkits';
        // this.globalNodeModules = this.getGlobalModules();

        this.config = this.readSteamerConfig();
        this.kitHomePath = path.join(this.getGlobalHome(), '.steamer', 'starterkits');
        this.kitOptionsPath = path.join(this.kitHomePath, 'starterkits.js');
        this.spinner = ora('Loading unicorns');
        this.kitOptions = this.getKitOptions();
        this.ignoreFiles = ['.git', '.svn'];
    }

    init(argv) {
        let argvs = argv || this.argv, // command argv
            isAdd = argvs.add,
            isTag = argvs.tag,
            isUpgrade = argvs.upgrade,
            isAlias = argvs.alias || null,
            isGlobal = argvs.global || argvs.g,
            isRemove = argvs.remove,
            isList = argvs.list || argvs.l;

        if (isAdd) {
            this.add(isAdd, isTag, isAlias);
        }
        else if (isUpgrade) {
            this.upgrade(isUpgrade, isGlobal);
        }
        else if (isRemove) {
            this.remove(isRemove);
        }
        else if (isList) {
            this.list();
        }
        else {
            this.install()
        }
    }

    add(repo, tag, alias) {
        this.clone(repo, tag, alias).then(() => {
            // console.log(this.kitOptions)
            this.writeKitOptions(this.kitOptions);
        }).catch((e) => {
            this.error(e.stack);
        });
    }

    clone(repo, tag = null, alias) {
        let nameSpace = this.getNameSpace(repo),
            kitName = alias || this.getKitName(nameSpace),
            localPath = path.join(this.kitHomePath , kitName);

        let opt = {
            repo,
            kitName,
            localPath,
            tag,
        };

        // starterkit exist and not add another version
        if (this.kitOptions.list.hasOwnProperty(kitName) && !tag) {
            this.error(`${kitName} exists. Please change the name useing --alias.`);
            return Promise.resolve();
        }
        else {
            if (!this.kitOptions.list.hasOwnProperty(kitName)) {
                this.kitOptions.list[kitName] = {
                    url: repo,
                    path: localPath,
                    versions: []
                };
            }
            if (opt.tag) {
                return this.cloneTag(opt)
            }
            else {
                return this.cloneLatest(opt);
            }
        }
    }

    cloneLatest(options) {
        let {
            repo,
            kitName,
            localPath,
        } = options;
        return new Promise((resolve, reject) => {
            git()
                .silent(true)
                .exec(() => {
                    this.spinner.start();
                    this.spinner.color = 'cyan';
                    this.spinner.text = `installing ${kitName}`;
                })
                .clone(repo, localPath, '--depth=1', (err) => {
                    err && this.spinFail(kitName, err);
                })
                .exec(() => {
                    let pkgJson = this.getPkgJson(localPath);
                    this.kitOptions.list[kitName] = this._.merge({}, this.kitOptions.list[kitName], {
                        description: pkgJson.description,
                        currentVersion: pkgJson.version,
                        latestVersion: pkgJson.version,
                        versions: [
                            pkgJson.version
                        ]
                    });
                    git(localPath)
                        .silent(true)
                        .branch([pkgJson.version], (err) => {
                            err && this.spinFail(kitName, err)
                        })
                        .checkout(pkgJson.version, (err) => {
                            if (err) {
                                this.spinFail(kitName, err);
                            }
                            else {
                                this.spinSuccess(`${kitName}@${pkgJson.version} installed`);
                            }
                        })
                        .branch(['-D', 'master'], (err) => {
                            resolve();
                        });
                });
        });
    }

    // fetch specific tag https://stackoverflow.com/questions/45338495/fetch-a-single-tag-from-remote-repository
    // git branch new_branch tag_name
    cloneTag(options) {
        let {
            repo,
            kitName,
            localPath,
            tag
        } = options;

        this.fs.ensureDirSync(localPath); 

        return new Promise((resolve, reject) => {
            git(localPath)
                .silent(true)
                .exec(() => {
                    this.spinner.start();
                    this.spinner.color = 'cyan';
                    this.spinner.text = `installing ${kitName}`;
                })
                .exec(() => {
                    let isGitFolderExists = this.fs.existsSync(path.join(localPath, '.git'));
                    
                    if (!isGitFolderExists) {
                        spawn.sync('git', ['init'], { cwd: localPath });
                        spawn.sync('git', ['remote', 'add', 'origin', repo], { cwd: localPath });
                    }
                })
                .fetch(['origin', `refs/tags/${tag}:refs/tags/${tag}`], (err) => {
                    if (err) {
                        return this.spinFail(kitName, err);
                    }
                    let version = this.getVersion(tag);
                    git(localPath)
                        .silent(true)
                        .branch([`${version}`, `${tag}`], (err) => {
                            err && this.spinFail(kitName, err);
                        })
                        .checkout(`${version}`, () => {
                            this.spinSuccess(`${kitName}@${version} installed`);
                            let pkgJson = this.getPkgJson(localPath),
                                versions = this.addVersion(this.kitOptions.list[kitName].versions, pkgJson.version);
        
                            this.kitOptions.list[kitName] = this._.merge({}, this.kitOptions.list[kitName], {
                                description: pkgJson.description,
                                currentVersion: pkgJson.version,
                                latestVersion: versions[0],
                                versions: versions
                            });
                            resolve();
                        });  
                })
            });
    }

    upgrade(kit, isGlobal) {
        if (kit && kit !== true, isGlobal) {
            this.upgradeGlobal(kit).then((newVer) => {
                if (newVer) {
                    this.kitOptions.list[kit].versions = this.addVersion(this.kitOptions.list[kit].versions, newVer);
                    this.kitOptions.list[kit].currentVersion = newVer;
                    this.kitOptions.list[kit].latestVersion = newVer;
                    this.writeKitOptions(this.kitOptions);
                }
            }).catch((e) => {
                this.error(e.stack);
            });
        }
        else if (!isGlobal) {
            this.upgradeLocal();
        }
    }

    upgradeLocal() {    
        let pluginConfig = this.readConfig();
        if (!pluginConfig.hasOwnProperty('kit')) {
            return this.error('.steamer/steamer-plugin-kit.js does not have current project kit value.');
        }

        let kit = pluginConfig.kit,
            curVer = pluginConfig.version;

        if (!this.kitOptions.list.hasOwnProperty(kit)) {
            return this.error(`Please install ${kit} starterkit before you upgrade.`);
        }

        let kitOptions = this.kitOptions.list[kit],
            kitPath = kitOptions.path;

        if (compareVer(curVer, kitOptions.latestVersion) >= 0) {
            return this.info('Your project has already used the latest starterkit.');
        }
        
        let keepFiles = ['src', 'config', 'tools'];

        let files = this.fs.readdirSync(kitPath);
        files = files.filter((item) => {
            return !this.ignoreFiles.includes(item);
        });

        git(kitPath)
            .checkout(kitOptions.latestVersion, (err) => {
                if (err) {
                    return this.error(err);
                }

                let copyFiles = this.backupFiles(files, keepFiles, kitPath);
                
                this.copyUpdateFiles(copyFiles, kitPath);
        
                this.copyUpdatePkgJson(kitPath);

                spawn.sync(this.config.NPM, ['install'], { stdio: 'inherit', cwd: process.cwd() });

                this.success(`The project has been upgraded to ${kitOptions.latestVersion}`);
            });

        
    }

    backupFiles(files, keepFiles, kitPath) {
        files = files.filter((item) => {
            return !keepFiles.includes(item);
        });

        let ts = Date.now();

        files.forEach((item) => {
            this.fs.copySync(path.join(kitPath, item), path.join(process.cwd(), `backup/${ts}`, item));
        });

        return files;
    }
    
    copyUpdateFiles(files, kitPath) {
        files = files.filter((item) => {
            return item !== 'package.json' && item !== 'package-lock.json';
        });

        files.forEach((item) => {
            this.fs.copySync(path.join(kitPath, item), path.join(process.cwd(), item));
        });
    }

    copyUpdatePkgJson(kitPath) {
        this.fs.removeSync(path.join(process.cwd(), 'package-lock.json'));
        let oldPkgJson = require(path.join(process.cwd(), 'package.json')),
            newPkgJson = require(path.join(kitPath, 'package.json'));

        let pkgJson = _.merge({}, oldPkgJson, {
            version: newPkgJson.version,
            dependencies: newPkgJson.dependencies,
            devDependencies: newPkgJson.devDependencies,
        });

        this.fs.writeFileSync(path.join(process.cwd(), 'package.json'), JSON.stringify(pkgJson, null, 4), 'utf-8');
    }

    upgradeGlobal(kitName) {
        let kits = this.kitOptions.list;
        
        if (!kits.hasOwnProperty(kitName)) {
            return this.error(`The starterkit ${kitName} does not exist.`);
        }

        let kitOptions = kits[kitName];

        return new Promise((resolve, reject) => {
            git(kitOptions.path)
                .silent(true)
                .exec(() => {
                    this.spinner.start();
                    this.spinner.color = 'cyan';
                    this.spinner.text = `updating ${kitName}`;
                })
                .fetch(['origin', 'master:master'], (err) => {
                    err && this.spinFail(kitName, err);
                })
                .checkout('master')
                .exec(() => {
                    let curKitOptions = require(path.join(this.kitHomePath, kitName, 'package.json')),
                        oldVer = kitOptions.latestVersion,
                        newVer = curKitOptions.version;
                    
                    if (compareVer(newVer, oldVer) > 0) {
                        git(kitOptions.path)
                            .silent(true)
                            .branch([newVer, 'master'], (err) => {
                                err && this.spinFail(kitName, err);
                            })
                            .checkout(newVer, (err) => {
                                err && this.spinFail(kitName, err);
                            })
                            .branch(['-D', 'master'], () => {
                                this.spinSuccess(`${kitName}@${newVer} installed`);
                                resolve(newVer);
                            });
                    }
                    else {
                        git(kitOptions.path)
                            .silent(true)
                            .checkout(newVer, (err) => {
                                err && this.spinFail(kitName, err);
                            })
                            .branch(['-D', 'master'], () => {
                                this.spinSuccess(`${kitName}@${newVer} installed`);
                                resolve();
                            });
                    }
                });
        });
    }

    remove(kit) {
        let kits = this.kitOptions.list;

        if (!kits.hasOwnProperty(kit)) {
            return this.error(`The starterkit ${kit} does not exist.`);
        }
        
        this.fs.removeSync(this.kitOptions.list[kit].path);
        delete this.kitOptions.list[kit];
        this.writeKitOptions(this.kitOptions);
        this.success(`The kit ${kit} is removed.`);
    }

    getKitOptions() {
        
        if (!this.fs.existsSync(this.kitOptionsPath)) {
            let options = {
                list: {},
                timestamp: Date.now()
            };
            this.fs.ensureFileSync(this.kitOptionsPath);
            this.fs.writeFileSync(this.kitOptionsPath, `module.exports = ${JSON.stringify(options, null, 4)};`, 'utf-8');
        }

        return require(this.kitOptionsPath);
    }

    writeKitOptions(options, key) {
        try {
            let updatedOptions = this.getKitOptions();
            
            if (key) {
                updatedOptions.list[key] = options.list[key];
            }
            
            updatedOptions.timestamp = Date.now();
            this.fs.writeFileSync(this.kitOptionsPath, `module.exports = ${JSON.stringify(updatedOptions, null, 4)};`, 'utf-8');
    
        }
        catch (e) {
            this.error(e.stack);
        }
    }
    
    addVersion(oldVers, newVer) {
        for (let i = 0, len = oldVers.length; i < len; i++) {
            if (compareVer(newVer, oldVers[i]) > 0) {
                oldVers.unshift(newVer);
                return oldVers;
            }
        }

        oldVers.push(newVer);
        return oldVers;
    }

    getPkgJson(localPath) {
        let pkgJsonPath = path.join(localPath, 'package.json');
        if (this.fs.existsSync(pkgJsonPath)) {
            return require(pkgJsonPath);
        }
        else {
            throw new Error('package.json does not exist');
        }
    }

    getNameSpace(repo) {
        let localPath = '';
        if (repo.indexOf('http') >= 0) {
            repo = url.parse(repo);
            if (!repo.host) {
                return this.error('Please input correct repo url');
            }
            localPath = `${repo.host}${repo.pathname.replace('.git', '')}`;
        }
        else if (repo.indexOf('git@') === 0) {
            localPath = repo.replace('git@', '').replace('.git', '').replace(':', '/');
        }
        else if (typeof this.kitOptions.list[repo] !== 'undefined') {
            localPath = this.getNameSpace(this.kitOptions.list[repo].url);
        }

        return localPath;
    }

    getKitName(ns) {
        let kit = null;
        if (ns.split('/').length === 3) {
            kit = ns.split('/')[2];
        }
        return kit;
    }

    getVersion(tag) {
        return tag.replace(/[a-zA-Z]+/ig, '');
    }

    spinSuccess(msg) {
        this.spinner.stop().succeed([
            msg
        ]);
    }

    spinFail(kitName, err) {
        this.spinner.stop().fail([
            `${kitName} ${err}`
        ]);
    }

    list() {
        this.log('You can use following starterkits: ');
        let kits = this.kitOptions.list;
        Object.keys(kits).forEach((key) => {
            let kit = kits[key];
            this.success(this.chalk.bold(`* ${key}`));
            this.log(`    - ver: ${kit.currentVersion}`);
            this.log(`    - des: ${kit.description}`);
            this.log(`    - url: ${kit.url}`);
        });
    }

    install() {
        let kits = this.kitOptions.list,
            questions = [],
            choices = [];

        Object.keys(kits).forEach((key) => {
            choices.push({
                name: `${key} - ${kits[key].description}`,
                value: key
            });
        });

        let answers = {};
        let prompts = new Rx.Subject();
        inquirer.prompt(prompts).ui.process.subscribe(
            (obj) => {
                switch (obj.name) {
                    case 'kit': {
                        prompts.onNext({
                            type: 'list',
                            name: 'ver',
                            message: 'Which version do you need: ',
                            choices: kits[obj.answer].versions
                        });
                        answers.kit = obj.answer;
                        break;
                    }
                    case 'ver': {
                        prompts.onNext({
                            type: 'text',
                            name: 'folder',
                            default: './',
                            message: 'Which folder is your project in: ',
                        });
                        answers.ver = obj.answer;
                        prompts.onCompleted();
                        break;
                    }
                    case 'folder': {
                        answers.folder = obj.answer.trim();
                        break;
                    }
                }
            },
            () => {
            },
            () => {
                this.installKit(answers);
            }
        );

        prompts.onNext({
            type: 'list',
            name: 'kit',
            message: 'Which starterkit do you wanna install: ',
            choices: choices,
            pageSize: 100
        });
    }

    installKit(options) {
        let {
            kit,
            ver,
            folder
        } = options;

        let kitPath = path.join(this.kitHomePath, kit),
            kitConfigPath = path.join(kitPath, `.steamer/${kit}.js`),
            kitConfig = {},
            isSteamerKit = false,
            folderPath = path.join(process.cwd(), folder),
            kitQuestions = [],
            files = [];
       
        git(kitPath)
            .checkout(ver, () => {
                // 查看是否能获取steamer规范的脚手架配置
                if (this.fs.existsSync(kitConfigPath)) {
                    kitConfig = require(kitConfigPath);
                    files = kitConfig.installFiles || kitConfig.files;
                    files.push('package.json'),
                    kitQuestions = kitConfig.options;
                    isSteamerKit = true;
                }
                else {
                    files = this.fs.readdirSync(kitPath);
                }

                let isEmpty = this.checkEmpty(folderPath),
                    overwriteQuestion = [];
                    
                if (!isEmpty) {
                    overwriteQuestion.push({
                        type: 'text',
                        name: 'overwrite',
                        message: 'The foler is not empty, do you wanna overrite?',
                        default: 'n'
                    });
                }

                let prompt = inquirer.createPromptModule();
                prompt(overwriteQuestion).then((answers) => {
                    if (!answers.hasOwnProperty('overwrite')
                        || answers.overwrite && answers.overwrite === 'y') {
                        this.copyFiles({files, kitQuestions, folderPath, kitPath, kit, ver, isSteamerKit});
                    }
                }).catch((e) => {
                    this.error(e.stack);
                });
                
            });
    }

    /**
     * copy starterkit files to project folder
     */
    copyFiles(options) {
        let {
            files,
            kitQuestions,
            folderPath,
            kitPath,
            kit,
            ver,
            isSteamerKit
        } = options;
        // 脚手架相关配置问题
        let prompt = inquirer.createPromptModule();
        prompt(kitQuestions).then((answers) => {
            if (answers.webserver) {
                this.fs.ensureFileSync(path.join(folderPath, 'config/steamer.config.js'));
                this.fs.writeFileSync(path.join(folderPath, 'config/steamer.config.js'), 'module.exports = ' + JSON.stringify(answers, null, 4));
            }

            files = files.filter((item) => {
                return !this.ignoreFiles.includes(item);
            });

            files.forEach((item) => {
                let srcFiles = path.join(kitPath, item),
                    destFile = path.join(folderPath, item);
                this.fs.copySync(srcFiles, destFile);
            });

            if (isSteamerKit) {
                this.createPluginConfig({
                    kit: kit,
                    version: ver
                }, folderPath);
            }

            // 安装项目node_modules包
            spawn.sync(this.config.NPM, ['install'], { stdio: 'inherit', cwd: folderPath });
            this.success(`The project is initiated success in ${folderPath}`);
        }).catch((e) => {
            this.error(e.stack);
        });
        
    }

    /**
     * check folder empty or not
     * @param {*} folderPath 
     */
    checkEmpty(folderPath) {
        // 查看目标目录是否为空
        if (path.resolve(folderPath) === process.cwd()) {
            let folderInfo = this.fs.readdirSync(folderPath);
            folderInfo = folderInfo.filter((item) => {
                return !this.ignoreFiles.includes(item);
            });
            return !folderInfo.length;
        }
        else {
            return !this.fs.existsSync(folderPath);
        }
    }

    createPluginConfig(conf, folder) {
        let config = conf;

        this.createConfig(config, {
            folder: folder,
            overwrite: true,
        });
    }

    /**
     * [help]
     */
    help() {
        this.printUsage('steamer kit manager', 'kit');
        this.printOption([
            // {
            //     option: 'list',
            //     alias: 'l',
            //     description: 'list all available starter kits'
            // },
            // {
            //     option: 'install',
            //     alias: 'i',
            //     value: '<starter kit> [--path|-p] <project path>',
            //     description: 'install starter kit'
            // },
            // {
            //     option: 'update',
            //     alias: 'u',
            //     value: '[<starter kit>]',
            //     description: 'update starter kit for project'
            // }
        ]);
    }
}

module.exports = KitPlugin;