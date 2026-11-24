'use client'
import { motion } from 'motion/react'
import { XIcon } from 'lucide-react'
import { Spotlight } from '@/components/ui/spotlight'
import { Magnetic } from '@/components/ui/magnetic'
import {
  MorphingDialog,
  MorphingDialogTrigger,
  MorphingDialogContent,
  MorphingDialogClose,
  MorphingDialogContainer,
} from '@/components/ui/morphing-dialog'
import Link from 'next/link'
import { AnimatedBackground } from '@/components/ui/animated-background'
import type { PublishedPostSummary } from '@/modules/posts/model'
import {
  PROFILE,
  PROJECTS,
  WORK_EXPERIENCE,
  EMAIL,
  SOCIAL_LINKS,
} from '../data'
import { routes } from '@/lib/routes'

const VARIANTS_CONTAINER = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
}

const VARIANTS_SECTION = {
  hidden: { opacity: 0, y: 20, filter: 'blur(8px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
}

const TRANSITION_SECTION = {
  duration: 0.3,
}

type ProjectVideoProps = {
  src: string
}

function ProjectVideo({ src }: ProjectVideoProps) {
  return (
    <MorphingDialog
      transition={{
        type: 'spring',
        bounce: 0,
        duration: 0.3,
      }}
    >
      <MorphingDialogTrigger>
        <video
          src={src}
          autoPlay
          loop
          muted
          className="aspect-video w-full cursor-zoom-in rounded-xl"
        />
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent className="relative aspect-video rounded-2xl bg-card p-1 ring-1 ring-border/50 ring-inset">
          <video
            src={src}
            autoPlay
            loop
            muted
            className="aspect-video h-[50vh] w-full rounded-xl md:h-[70vh]"
          />
        </MorphingDialogContent>
        <MorphingDialogClose
          className="fixed top-6 right-6 h-fit w-fit rounded-full bg-background p-1"
          variants={{
            initial: { opacity: 0 },
            animate: {
              opacity: 1,
              transition: { delay: 0.3, duration: 0.1 },
            },
            exit: { opacity: 0, transition: { duration: 0 } },
          }}
        >
          <XIcon className="h-5 w-5 text-muted-foreground" />
        </MorphingDialogClose>
      </MorphingDialogContainer>
    </MorphingDialog>
  )
}

function MagneticSocialLink({
  children,
  link,
}: {
  children: React.ReactNode
  link: string
}) {
  return (
    <Magnetic springOptions={{ bounce: 0 }} intensity={0.3}>
      <a
        href={link}
        className="group relative inline-flex shrink-0 items-center gap-[1px] rounded-full bg-secondary px-2.5 py-1 text-sm text-secondary-foreground transition-colors duration-200 hover:bg-primary hover:text-primary-foreground"
      >
        {children}
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3"
        >
          <path
            d="M3.64645 11.3536C3.45118 11.1583 3.45118 10.8417 3.64645 10.6465L10.2929 4L6 4C5.72386 4 5.5 3.77614 5.5 3.5C5.5 3.22386 5.72386 3 6 3L11.5 3C11.6326 3 11.7598 3.05268 11.8536 3.14645C11.9473 3.24022 12 3.36739 12 3.5L12 9.00001C12 9.27615 11.7761 9.50001 11.5 9.50001C11.2239 9.50001 11 9.27615 11 9.00001V4.70711L4.35355 11.3536C4.15829 11.5488 3.84171 11.5488 3.64645 11.3536Z"
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
          ></path>
        </svg>
      </a>
    </Magnetic>
  )
}

type HomeContentProps = {
  posts: PublishedPostSummary[]
}

// 首页只展示最近的几篇，完整列表在文章索引页。
const RECENT_POSTS = 4

function Section({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <motion.section className={className} variants={VARIANTS_SECTION} transition={TRANSITION_SECTION}>
      {children}
    </motion.section>
  )
}

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-medium text-muted-foreground">{children}</h2>
      {action}
    </div>
  )
}

export function HomeContent({ posts }: HomeContentProps) {
  return (
    <motion.main
      className="canvas-grid gap-y-14 md:gap-y-20"
      variants={VARIANTS_CONTAINER}
      initial="hidden"
      animate="visible"
    >
      <Section className="col-span-full space-y-6 md:col-span-7">
        <div>
          <h1 className="text-3xl font-medium md:text-4xl">{PROFILE.name}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{PROFILE.role}</p>
        </div>
        <p className="max-w-140 text-lg">{PROFILE.description}</p>
        <div className="flex flex-wrap items-center gap-3">
          {SOCIAL_LINKS.map((link) => (
            <MagneticSocialLink key={link.label} link={link.link}>
              {link.label}
            </MagneticSocialLink>
          ))}
          <a className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground" href={`mailto:${EMAIL}`}>
            {EMAIL}
          </a>
        </div>
      </Section>

      <Section className="col-span-full md:col-span-5">
        <SectionHeading
          action={
            <Link href={routes.blog} className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
              All posts
            </Link>
          }
        >
          Recent writing
        </SectionHeading>
        {posts.length > 0 ? (
          <div className="flex flex-col">
            <AnimatedBackground
              enableHover
              className="h-full w-full rounded-lg bg-accent"
              transition={{
                type: 'spring',
                bounce: 0,
                duration: 0.2,
              }}
            >
              {posts.slice(0, RECENT_POSTS).map((post) => (
                <Link
                  key={post.id}
                  className="-mx-3 rounded-xl px-3 py-3"
                  href={routes.post(post.id)}
                  data-id={post.id}
                >
                  <div className="flex flex-col space-y-1">
                    <h3 className="font-medium">{post.title}</h3>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{post.description}</p>
                  </div>
                </Link>
              ))}
            </AnimatedBackground>
          </div>
        ) : (
          <p className="text-muted-foreground">No posts yet.</p>
        )}
      </Section>

      <Section className="col-span-full">
        <SectionHeading>Selected projects</SectionHeading>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
          {PROJECTS.map((project) => (
            <div key={project.name} className="space-y-2">
              {project.video && (
                <div className="relative rounded-2xl bg-muted/40 p-1 ring-1 ring-border/50 ring-inset">
                  <ProjectVideo src={project.video} />
                </div>
              )}
              <div className="px-1">
                <a
                  className="group relative inline-block font-medium text-foreground"
                  href={project.link}
                  target="_blank"
                >
                  {project.name}
                  <span className="absolute bottom-0.5 left-0 block h-[1px] w-full max-w-0 bg-foreground transition-all duration-200 group-hover:max-w-full"></span>
                </a>
                <p className="text-muted-foreground">{project.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section className="col-span-full">
        <SectionHeading>Work experience</SectionHeading>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {WORK_EXPERIENCE.map((job) => (
            <a
              className="relative overflow-hidden rounded-2xl bg-border p-[1px]"
              href={job.link}
              target="_blank"
              rel="noopener noreferrer"
              key={job.id}
            >
              <Spotlight
                className="from-foreground via-foreground/90 to-foreground/80 blur-2xl"
                size={64}
              />
              <div className="relative h-full w-full rounded-[15px] bg-background p-4">
                <div className="relative flex w-full flex-row justify-between gap-4">
                  <div>
                    <h3 className="font-medium">{job.title}</h3>
                    <p className="text-muted-foreground">{job.company}</p>
                  </div>
                  <p className="shrink-0 text-sm text-muted-foreground">
                    {job.start} - {job.end}
                  </p>
                </div>
              </div>
            </a>
          ))}
        </div>
      </Section>
    </motion.main>
  )
}
