#!/usr/bin/env python3
"""Read-only Vercel identity checks; never mutate the linked project or its domains."""
import argparse
import json
import os
import re
import urllib.parse
import urllib.request
from release_gate import REPOSITORY, require, sha


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, target):
        return None


def read(path):
    token = os.environ.get('VERCEL_TOKEN', '')
    require(bool(token), 'Missing Vercel release credentials.')
    team = os.environ.get('VERCEL_ORG_ID', '')
    require(re.fullmatch(r'team_[A-Za-z0-9]+', team), 'Missing explicit Vercel team identity.')
    request = urllib.request.Request('https://api.vercel.com/' + path + '?teamId=' + team,
                                     headers={'Authorization': 'Bearer ' + token})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
        data = response.read(1024 * 1024 + 1)
    require(len(data) <= 1024 * 1024, 'Oversized Vercel metadata response.')
    return json.loads(data)


def project_identity(project, project_id, team_id, previous):
    require(project.get('id') == project_id and project.get('accountId') == team_id,
            'Vercel project or team does not match the approved target.')
    require(project.get('rootDirectory') == 'smart-factory-frontend',
            'Vercel must build the frontend directory within the canonical monorepo.')
    link = project.get('link') or {}
    require(link.get('type') == 'github' and link.get('org') == REPOSITORY.split('/')[0]
            and link.get('repo') == REPOSITORY.split('/')[1],
            'Vercel still depends on a different Git repository; do not promote or retire it.')
    require(isinstance(previous, str) and re.fullmatch(r'dpl_[A-Za-z0-9]+', previous),
            'An explicitly approved previous production deployment ID is required.')
    active = (project.get('targets') or {}).get('production') or {}
    require(active.get('id') == previous, 'Production changed after the approved baseline was captured.')
    return previous


def stage_identity(deployment, project_id, revision, origin):
    parsed = urllib.parse.urlsplit(origin)
    require(parsed.scheme == 'https' and parsed.username is None and parsed.password is None
            and parsed.port is None and parsed.path in ('', '/') and not parsed.query and not parsed.fragment
            and re.fullmatch(r'[a-z0-9-]+\.vercel\.app', parsed.hostname or ''),
            'The staged URL must be one direct Vercel HTTPS deployment origin.')
    require(deployment.get('projectId') == project_id and deployment.get('url') == parsed.hostname,
            'The staged deployment does not belong to the approved project.')
    require(deployment.get('readyState') == 'READY' and deployment.get('target') == 'production',
            'The staged production deployment is not ready.')
    require((deployment.get('meta') or {}).get('githubCommitSha') == sha(revision),
            'Staged deployment metadata does not identify the approved revision.')
    identity = deployment.get('id')
    require(isinstance(identity, str) and re.fullmatch(r'dpl_[A-Za-z0-9]+', identity),
            'The staged deployment has no valid immutable identity.')
    return identity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('project', 'stage'))
    parser.add_argument('--previous')
    parser.add_argument('--origin')
    parser.add_argument('--revision')
    args = parser.parse_args()
    project_id = os.environ.get('VERCEL_PROJECT_ID', '')
    require(re.fullmatch(r'prj_[A-Za-z0-9]+', project_id), 'An explicit Vercel project ID is required.')
    if args.mode == 'project':
        identity = project_identity(read('v9/projects/' + project_id), project_id,
                                    os.environ['VERCEL_ORG_ID'], args.previous)
    else:
        require(isinstance(args.origin, str), 'A staged origin is required.')
        host = urllib.parse.urlsplit(args.origin).hostname or ''
        require(re.fullmatch(r'[a-z0-9-]+\.vercel\.app', host), 'Invalid staged deployment hostname.')
        identity = stage_identity(read('v13/deployments/' + host), project_id, args.revision, args.origin)
    print(json.dumps({'verifiedDeploymentId': identity, 'productionChanged': False}))


if __name__ == '__main__':
    main()
