module.exports = {
	env: {
		es2021: true,
		node: true,
	},
	extends: [
		'airbnb-base',
		'airbnb-typescript/base',
	],
	parserOptions: {
		project: './tsconfig.json',
	},
	rules: {
		indent: 'off',
		'no-tabs': 'off',
		'no-plusplus': ['error', {
			allowForLoopAfterthoughts: true,
		}],
		'import/extensions': [
			'error',
			'ignorePackages',
			{
				js: 'never',
				ts: 'never',
			},
		],
		'@typescript-eslint/indent': ['error', 'tab'],
		'import/no-extraneous-dependencies': 'off',
		'import/prefer-default-export': 'off',
		'class-methods-use-this': 'off',
		'no-underscore-dangle': 'off',
		'no-await-in-loop': 'off',
		'no-restricted-syntax': 'off',
		'max-len': 'off',
		'no-console': 'off',
	},
};
