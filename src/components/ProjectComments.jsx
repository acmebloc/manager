import Comments from './Comments'

function ProjectComments({ projectId, members }) {
  return <Comments apiPath={`/api/projects/${projectId}/comments`} members={members} />
}

export default ProjectComments
